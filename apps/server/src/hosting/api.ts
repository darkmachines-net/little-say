/** @file Protects asynchronous AI jobs and media with automatic guest or registered ownership. */
import { type FastifyInstance } from 'fastify';
import { type Pool } from 'pg';
import { z } from 'zod';
import { proposalRequestSchema, translationRequestSchema, pictureAnalysisRequestSchema, pictureJobRequestSchema, pictureConceptSchema, speechRequestSchema } from '@little-say/core';
import { AccountError } from '../accounts/store';
import { AccountAccess } from '../accounts/access';
import { PictureJobs } from '../pictures/jobs';
import { Jobs, type JobKind, type JobView } from './jobs';
import { DatabaseCache, canReadMedia, type ObjectStore } from './storage';

export interface HostedServices { pool: Pool; jobs: Jobs; access: AccountAccess; objects: ObjectStore; enabled: boolean;
  /** Attempt prompt delivery after the durable commit; scheduled reconciliation covers failures. */
  dispatch?(id: string): Promise<void>;
}
const reviewSchema = z.object({ cards: z.array(z.object({ id: z.string().max(100), assetId: z.string().regex(/^[a-f0-9]{64}$/), concept: pictureConceptSchema })).min(1).max(24) });
const schemas = { proposal: proposalRequestSchema, translation: translationRequestSchema, analysis: pictureAnalysisRequestSchema, review: reviewSchema, speech: speechRequestSchema, picture: pictureJobRequestSchema };
const aliases: Record<string, JobKind> = { '/api/boards/propose': 'proposal', '/api/boards/translate': 'translation', '/api/pictures/analyze': 'analysis', '/api/pictures/review': 'review', '/api/speech': 'speech', '/api/pictures/jobs': 'picture' };
const submission = z.object({ id: z.uuid(), kind: z.enum(['proposal', 'translation', 'analysis', 'review', 'speech', 'picture']), input: z.unknown() });
const pictureState = (job: JobView) => ({ id: job.id, draftId: job.draftId ?? '', tileId: job.tileId ?? '', state: job.state === 'interrupted' ? 'error' : job.state, ...(job.result ? { result: job.result } : {}), ...(job.error ? { error: job.error } : {}) });

/** Validate the complete operation before storing a durable request or calling a provider. */
export function validateJobInput(kind: JobKind, input: unknown): unknown {
  const parsed = schemas[kind].safeParse(input);
  if (!parsed.success) throw new AccountError('The AI request is invalid.', 400);
  return parsed.data;
}

/** Register durable AI endpoints and intercept legacy routes so direct service URLs cannot bypass access controls. */
export async function hostingRoutes(app: FastifyInstance, services: HostedServices) {
  const { pool, jobs, access, objects } = services;
  const catalog = new PictureJobs(new DatabaseCache(pool, objects, 'pictures', undefined, true));
  app.addHook('onClose', async () => { catalog.close(); });
  app.addHook('onSend', async (request, reply, payload) => {
    if (/^\/api\/(pictures\/assets|speech)\/[a-f0-9]{64}\.(png|wav)(\?|$)/.test(request.url)) reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return payload;
  });
  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (path.startsWith('/api/ai/') || aliases[path] || /\/api\/pictures\/(jobs|batches)\//.test(path)) reply.header('Cache-Control', 'no-store');
    const asset = /^\/api\/(pictures\/assets|speech)\/([a-f0-9]{64}\.(?:png|wav))$/.exec(path);
    if (asset) {
      const namespace = asset[1] === 'speech' ? 'speech' : 'pictures';
      if (await canReadMedia(pool, namespace, asset[2])) return;
      const { account } = await access.verify(request);
      if (!await canReadMedia(pool, namespace, asset[2], account.id)) return reply.code(404).send({ error: 'Media unavailable.' });
      return;
    }
    const library = /^\/api\/pictures\/library\/([^/]+)$/.exec(path);
    if (library && request.method === 'GET') return reply.send({ picture: (await catalog.library(decodeURIComponent(library[1]))).picture });
    const legacyKind = aliases[path];
    if (legacyKind && request.method === 'POST') {
      const { account } = await access.verify(request);
      const input = validateJobInput(legacyKind, request.body);
      if (legacyKind === 'review') for (const card of (input as z.infer<typeof reviewSchema>).cards) {
        if (!await canReadMedia(pool, 'pictures', `${card.assetId}.png`, account.id)) throw new AccountError('Picture unavailable.', 404);
      }
      const raw = input as { requestId?: string; preparationId?: string };
      const id = raw.requestId ?? raw.preparationId ?? request.headers['x-little-say-request'];
      if (typeof id !== 'string') throw new AccountError('Update Little Say to submit asynchronous AI requests.', 400);
      const job = await jobs.submit(account.id, id, legacyKind, input);
      if (job.state === 'queued') await services.dispatch?.(job.id).catch(() => {});
      const original = input as { draftId: string; tileId: string };
      return reply.code(202).send(legacyKind === 'picture' ? { ...pictureState(job), draftId: original.draftId, tileId: original.tileId } : job);
    }
    const legacy = /^\/api\/pictures\/(jobs|batches)\/([^/]+)(\/cancel)?$/.exec(path);
    if (legacy) {
      const { account } = await access.verify(request);
      const job = legacy[3] && request.method === 'POST' ? await jobs.cancel(account.id, legacy[2]) : await jobs.get(account.id, legacy[2]);
      if (!job) return reply.code(404).send({ error: 'Job unavailable.' });
      if (legacy[1] === 'jobs') return reply.send(pictureState(job));
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
    if (job.state === 'queued') await services.dispatch?.(job.id).catch(() => {});
    return reply.code(202).send(job);
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
