/** @file Serves cached starter speech, dispatches authenticated jobs, and exposes owner-only activity counts. */
import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { type Pool } from 'pg';
import { z } from 'zod';
import { proposalRequestSchema, translationRequestSchema, pictureAnalysisRequestSchema, pictureJobRequestSchema, pictureConceptSchema, speechRequestSchema, speechKey, createStarterBoards } from '@little-say/core';
import { AccountError } from '../accounts/store';
import { AccountAccess } from '../accounts/access';
import { PictureJobs, PictureJobError } from '../pictures/jobs';
import { JobAdmissionError, Jobs, type JobKind, type JobView } from './jobs';
import { DatabaseCache, canReadMedia, type ObjectStore } from './storage';
import type { SpeechCache } from '../speech-cache';

export interface HostedServices { pool: Pool; jobs: Jobs; access: AccountAccess; objects: ObjectStore; enabled: boolean;
  /** Deliver a committed job to the queue for its kind; scheduled reconciliation covers failures. */
  dispatch?(id: string, kind: JobKind): Promise<void>;
}
const reviewSchema = z.object({ cards: z.array(z.object({ id: z.string().max(100), assetId: z.string().regex(/^[a-f0-9]{64}$/), concept: pictureConceptSchema })).min(1).max(24) });
const schemas = { proposal: proposalRequestSchema, translation: translationRequestSchema, analysis: pictureAnalysisRequestSchema, review: reviewSchema, speech: speechRequestSchema, picture: pictureJobRequestSchema };
const aliases: Record<string, JobKind> = { '/api/boards/propose': 'proposal', '/api/boards/translate': 'translation', '/api/pictures/analyze': 'analysis', '/api/pictures/review': 'review', '/api/speech': 'speech', '/api/pictures/jobs': 'picture' };
const submission = z.object({ id: z.uuid(), kind: z.enum(['proposal', 'translation', 'analysis', 'review', 'speech', 'picture']), input: z.unknown() });
const pictureState = (job: JobView) => ({ id: job.id, draftId: job.draftId ?? '', tileId: job.tileId ?? '', state: job.state === 'interrupted' ? 'error' : job.state, ...(job.result ? { result: job.result } : {}), ...(job.error ? { error: job.error } : {}) });
const starterWords = new Set(createStarterBoards(() => 'public').flatMap(board => board.tiles.map(tile => speechKey({ text: tile.speech, language: tile.language }))));

/** Validate the complete operation before storing a durable request or calling a provider. */
export function validateJobInput(kind: JobKind, input: unknown): unknown {
  const parsed = schemas[kind].safeParse(input);
  if (!parsed.success) throw new AccountError('The AI request is invalid.', 400);
  return parsed.data;
}

/** Require a public grant or an authenticated owner grant for a decoded media filename. */
export async function authorizeMedia(services: Pick<HostedServices, 'pool' | 'access'>, request: FastifyRequest, namespace: 'pictures' | 'speech', file: string) {
  if (await canReadMedia(services.pool, namespace, file)) return true;
  const { account } = await services.access.verify(request);
  return canReadMedia(services.pool, namespace, file, account.id);
}

/** Serve cached starter speech to guests and protect job admission, activity and private media with account checks. */
export async function hostingRoutes(app: FastifyInstance, services: HostedServices, speechCache?: SpeechCache) {
  const { pool, jobs, access, objects } = services;
  const catalog = new PictureJobs(new DatabaseCache(pool, objects, 'pictures', undefined, true));
  app.addHook('onClose', async () => { catalog.close(); });
  app.addHook('onError', async (_request, reply, error) => {
    if (error instanceof JobAdmissionError) reply.header('Retry-After', error.retryAfterSeconds);
  });
  app.addHook('onSend', async (request, reply, payload) => {
    const route = request.routeOptions.url;
    if (reply.statusCode === 200 && (route === '/api/pictures/assets/:file' || route === '/api/speech/:file')) {
      reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    }
    return payload;
  });
  app.addHook('preHandler', async (request, reply) => {
    const route = request.routeOptions.url ?? request.url.split('?')[0];
    if (route.startsWith('/api/ai/') || aliases[route] || route.startsWith('/api/pictures/jobs/') || route.startsWith('/api/pictures/batches/')) reply.header('Cache-Control', 'no-store');
    if (route === '/api/pictures/library/:id' && (request.method === 'GET' || request.method === 'HEAD')) {
      const id = (request.params as { id?: string } | undefined)?.id ?? '';
      try { return reply.send({ picture: (await catalog.library(id)).picture }); }
      catch (error) { return reply.code(error instanceof PictureJobError ? error.statusCode : 502).send({ error: 'This library picture could not be downloaded.' }); }
    }
    const legacyKind = aliases[route];
    if (legacyKind && request.method === 'POST') {
      if (legacyKind === 'speech' && speechCache) {
        const input = speechRequestSchema.safeParse(request.body);
        if (input.success && !input.data.regenerate && starterWords.has(speechKey(input.data))) {
          const [clip] = await speechCache.lookup([input.data]);
          if (clip) {
            // Same shared cache and media grants as ordinary playback. A new take of this public
            // vocabulary stays playable after regeneration; guests never reach generation below.
            await new DatabaseCache(pool, objects, 'speech', undefined, true).read(`${clip.id}.wav`);
            return reply.send({ ...clip, cacheHit: true });
          }
        }
      }
      const { account } = await access.verify(request);
      const input = validateJobInput(legacyKind, request.body);
      if (legacyKind === 'review') for (const card of (input as z.infer<typeof reviewSchema>).cards) {
        if (!await canReadMedia(pool, 'pictures', `${card.assetId}.png`, account.id)) throw new AccountError('Picture unavailable.', 404);
      }
      const raw = input as { requestId?: string; preparationId?: string };
      const id = raw.requestId ?? raw.preparationId ?? request.headers['x-little-say-request'];
      if (typeof id !== 'string') throw new AccountError('Update Little Say to submit asynchronous AI requests.', 400);
      const job = await jobs.submit(account.id, id, legacyKind, input);
      if (job.state === 'queued') await services.dispatch?.(job.id, job.kind).catch(() => {});
      const original = input as { draftId: string; tileId: string };
      return reply.code(202).send(legacyKind === 'picture' ? { ...pictureState(job), draftId: original.draftId, tileId: original.tileId } : job);
    }
    if (route === '/api/pictures/jobs/:id' || route === '/api/pictures/jobs/:id/cancel' || route === '/api/pictures/batches/:id' || route === '/api/pictures/batches/:id/cancel') {
      const { account } = await access.verify(request);
      const id = (request.params as { id?: string } | undefined)?.id ?? '';
      const job = route.endsWith('/cancel') && request.method === 'POST' ? await jobs.cancel(account.id, id) : await jobs.get(account.id, id);
      if (!job) return reply.code(404).send({ error: 'Job unavailable.' });
      if (route.startsWith('/api/pictures/jobs/')) return reply.send(pictureState(job));
      try {
        const record = JSON.parse((await new DatabaseCache(pool, objects, `batches/${account.id}`).read(`batch-${job.id}.json`)).toString());
        if (['cancelled', 'interrupted', 'error'].includes(job.state)) record.batch.state = job.state === 'cancelled' ? 'cancelled' : 'error';
        return reply.send(record.batch);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return reply.send({ id: job.id, state: job.state === 'queued' || job.state === 'working' ? 'working' : job.state === 'cancelled' ? 'cancelled' : 'error', tiles: [] });
      }
    }
  });
  app.post('/api/ai/jobs', { bodyLimit: 512 * 1024 }, async (request, reply) => {
    const { account } = await access.verify(request);
    const parsed = submission.safeParse(request.body);
    if (!parsed.success) throw new AccountError('Provide a valid AI operation.', 400);
    const { id, kind } = parsed.data, input = validateJobInput(kind, parsed.data.input);
    if (kind === 'review') for (const card of (input as z.infer<typeof reviewSchema>).cards) {
      if (!await canReadMedia(pool, 'pictures', `${card.assetId}.png`, account.id)) throw new AccountError('Picture unavailable.', 404);
    }
    if (kind === 'proposal') (input as { preparationId?: string }).preparationId = id;
    const job = await jobs.submit(account.id, id, kind, input);
    if (job.state === 'queued') await services.dispatch?.(job.id, job.kind).catch(() => {});
    return reply.code(202).send(job);
  });
  app.get('/api/ai/activity', async request => {
    const { account } = await access.verify(request);
    return jobs.activity(account.id);
  });
  app.get<{ Params: { id: string } }>('/api/ai/jobs/:id', async (request, reply) => {
    const { account } = await access.verify(request);
    const job = await jobs.get(account.id, request.params.id);
    return job ?? reply.code(404).send({ error: 'Job unavailable.' });
  });
  app.post<{ Params: { id: string } }>('/api/ai/jobs/:id/cancel', async (request, reply) => {
    const { account } = await access.verify(request);
    return await jobs.cancel(account.id, request.params.id) ?? reply.code(404).send({ error: 'Job unavailable.' });
  });
}
