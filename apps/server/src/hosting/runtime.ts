/** @file Wires hosted job limits, queued execution, image capacity, and content-free worker diagnostics. */
import { resolve } from 'node:path';
import { DatabaseError, type Pool } from 'pg';
import { OAuthError, OpenAIError, SubjectTokenProviderError } from 'openai';
import { type ProposalRequest, type TranslationRequest, type PictureAnalysisRequest, type PictureJobRequest, type SpeechInput, validateGeneratedBoard, validateTranslations } from '@little-say/core';
import { createDatabase, checkDatabase } from '../database';
import { Accounts } from '../accounts/store';
import { FirebaseIdentity } from '../accounts/firebase';
import { AccountAccess } from '../accounts/access';
import { openAIProvider } from '../provider';
import { openAICredential } from '../openai-auth';
import { openAIPictureProvider, type PictureProvider } from '../pictures/provider';
import { PictureJobs } from '../pictures/jobs';
import { SpeechCache } from '../speech-cache';
import { openAISynthesis, speechProfile, SpeechSynthesisError } from '../synthesis';
import { BoardPreparation } from '../board-preparation';
import { GenericContent } from '../generic-content';
import { DatabaseCache, FileObjects, pruneMedia, type ObjectStore } from './storage';
import { GoogleObjects, GoogleDispatch } from './google';
import { Jobs, type Job, type JobKind } from './jobs';
import { readAiLimits } from './limits';
import { fixtureProviders } from './fixtures';
import { draftFailure } from '../draft-diagnostics';

class ProviderUnavailable extends Error {}

type JobInterruption =
  | { category: 'shutdown' | 'cancelled' | 'claim-lost' }
  | { category: 'heartbeat-failed'; cause: unknown };

function workerFailure(error: unknown) {
  if (error instanceof ProviderUnavailable) return { category: 'provider-unconfigured' };
  if (error instanceof SubjectTokenProviderError) return { category: 'subject-token' };
  if (error instanceof OAuthError) return { category: 'token-exchange', status: error.status };
  if (error instanceof SpeechSynthesisError) return { category: error.category };
  if (error instanceof DatabaseError) return { category: 'database', code: /^[0-9A-Z]{5}$/.test(error.code ?? '') ? error.code : undefined };
  const { category, status } = draftFailure(error);
  if (category === 'unknown' && error instanceof OpenAIError) return { category: 'provider' };
  return { category, status: typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined };
}

function reportInterruption(job: Job, stage: 'execute' | 'heartbeat' | 'finalize', failure: ReturnType<typeof workerFailure>, expected = false) {
  const message = expected ? 'AI operation stopped.' : 'AI operation interrupted; automatic provider retry disabled.';
  const write = expected ? console.warn : console.error;
  write(JSON.stringify({ severity: expected ? 'WARNING' : 'ERROR', message, jobId: job.id, kind: job.kind, stage, ...failure }));
}

/** Validate execution limits, then open owned resources and route background speech to its own queue when configured. */
export async function hostedRuntime(env: NodeJS.ProcessEnv = process.env) {
  if (!env.FIREBASE_PROJECT_ID) throw new Error('Configure Firebase and PostgreSQL, or use npm run dev for the local stack.');
  if (env.NODE_ENV === 'production' && env.AAC_AI_FIXTURES === 'true') throw new Error('Fixture AI is forbidden in production.');
  const limits = readAiLimits(env);
  const pool = createDatabase(env);
  try {
    await checkDatabase(pool);
    const auth = new FirebaseIdentity(env), accounts = new Accounts(pool);
    const objects: ObjectStore = env.MEDIA_BUCKET ? new GoogleObjects(env.MEDIA_BUCKET) : new FileObjects(resolve(env.MEDIA_DIRECTORY || '../../.cache/media'));
    const enabled = env.AAC_AI_ENABLED !== 'false' && Boolean(env.AAC_AI_FIXTURES === 'true' || openAICredential(env) || (env.K_SERVICE && env.WORKER_MODE !== 'cloud' && env.AAC_AI_WORKER_CONFIGURED === 'true'));
    const jobs = new Jobs(pool, enabled, limits), access = new AccountAccess(accounts, auth);
    const dispatcher = env.TASKS_QUEUE ? new GoogleDispatch(env.TASKS_QUEUE, env.WORKER_URL || '', env.TASKS_INVOKER || '') : undefined;
    if (env.TASKS_SPEECH_QUEUE && !dispatcher) throw new Error('TASKS_SPEECH_QUEUE requires TASKS_QUEUE.');
    const speechDispatcher = env.TASKS_SPEECH_QUEUE ? new GoogleDispatch(env.TASKS_SPEECH_QUEUE, env.WORKER_URL || '', env.TASKS_INVOKER || '') : dispatcher;
    return { pool, auth, accounts, objects, enabled, jobs, access, dispatcher, env,
      /** Deliver an admitted job to its execution queue; database state survives a lost response. */
      dispatch: async (id: string, kind: JobKind) => { await (kind === 'speech' ? speechDispatcher : dispatcher)?.send(id); },
    };
  } catch (error) { await pool.end(); throw error; }
}
export type Runtime = Awaited<ReturnType<typeof hostedRuntime>>;

/** Build API caches without worker-specific grants or provider credentials. */
export function apiCaches(runtime: Pick<Runtime, 'pool' | 'objects' | 'env'>) {
  return { pictures: new PictureJobs(new DatabaseCache(runtime.pool, runtime.objects, 'pictures'), undefined, runtime.env.AAC_IMAGE_GENERATION !== 'false'),
    speechCache: new SpeechCache(new DatabaseCache(runtime.pool, runtime.objects, 'speech'), speechProfile(runtime.env), null) };
}

/** Publish board words early and run independent image misses through the shared account and service budgets. */
export async function executeJob(runtime: Pick<Runtime, 'pool' | 'objects' | 'jobs' | 'env'>, job: Job, signal: AbortSignal) {
  const { pool, objects, jobs, env } = runtime;
  const fixture = env.AAC_AI_FIXTURES === 'true' ? fixtureProviders() : undefined;
  const provider = fixture?.boards ?? openAIProvider(env), rawPictures = fixture?.pictures ?? openAIPictureProvider(env);
  const pictureProvider: PictureProvider | undefined = rawPictures && {
    ...rawPictures,
    /** Hold capacity only for the paid image generation call; keep caching and validation independent. */
    generate(concept, style, imageSignal) {
      const combined = AbortSignal.any([signal, imageSignal]);
      return jobs.images.run(job, combined, () => rawPictures.generate(concept, style, combined));
    },
  };
  const pictures = new PictureJobs(new DatabaseCache(pool, objects, 'pictures', job.account_id), pictureProvider, env.AAC_IMAGE_GENERATION !== 'false', 1);
  // The account grants downloads; DatabaseCache keeps speech lookup identity independent of it.
  const speech = new SpeechCache(new DatabaseCache(pool, objects, 'speech', job.account_id), speechProfile(env), fixture?.speech ?? openAISynthesis(env, speechProfile(env)), 1);
  const content = new GenericContent(new DatabaseCache(pool, objects, 'generic-v1'));
  const imageConcurrency = Math.min(jobs.limits.accountImageConcurrency, jobs.limits.serviceImageConcurrency);
  const preparation = provider?.prepare ? new BoardPreparation(new DatabaseCache(pool, objects, `batches/${job.account_id}`), provider, pictures, content, speech, imageConcurrency) : undefined;
  const cancel = () => preparation?.close(); signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    switch (job.kind) {
      case 'proposal': {
        if (!provider) throw new ProviderUnavailable('AI unavailable.');
        const input = { ...job.input as ProposalRequest, preparationId: job.id };
        if (!preparation) return { boardId: input.board?.id ?? null, baseRevision: input.board?.revision ?? null, proposal: validateGeneratedBoard(await provider.propose(input), input.board) };
        const result = await preparation.propose(input, async draft => { signal.throwIfAborted(); await jobs.progress(job, draft); }); signal.throwIfAborted();
        await jobs.progress(job, result); await preparation.drain(job.id, signal);
        return { ...result, preparation: await preparation.status(job.id) };
      }
      case 'translation': {
        if (!provider?.translate) throw new ProviderUnavailable('AI unavailable.');
        const input = job.input as TranslationRequest;
        return validateTranslations(input, await provider.translate(input));
      }
      case 'analysis': {
        if (!pictureProvider) throw new ProviderUnavailable('AI unavailable.');
        return pictureProvider.analyze(job.input as PictureAnalysisRequest);
      }
      case 'review': return { rejected: await pictures.review((job.input as { cards: Parameters<PictureJobs['review']>[0] }).cards) };
      case 'speech': {
        const input = job.input as SpeechInput & { regenerate?: boolean };
        return { text: input.text, language: input.language, ...await speech.get(input, input.regenerate) };
      }
      case 'picture': return pictures.resolve(job.input as PictureJobRequest, signal, async () => { signal.throwIfAborted(); });
    }
  } finally { signal.removeEventListener('abort', cancel); preparation?.close(); pictures.close(); }
}

/** Heartbeat and settle a claim once, logging only bounded diagnostic fields when work halts. */
export async function runJob(runtime: Runtime, job: Job, shutdown: AbortSignal) {
  const controller = new AbortController();
  const interrupt = (reason: JobInterruption) => controller.abort(reason);
  const stop = () => interrupt({ category: 'shutdown' });
  shutdown.addEventListener('abort', stop, { once: true });
  if (shutdown.aborted) stop();
  let updating = false;
  const timer = setInterval(() => {
    if (updating || controller.signal.aborted) return;
    updating = true;
    void runtime.jobs.heartbeat(job).then(state => {
      if (state === 'cancelled') interrupt({ category: 'cancelled' });
      if (state === 'lost') interrupt({ category: 'claim-lost' });
    }, cause => interrupt({ category: 'heartbeat-failed', cause })).finally(() => { updating = false; });
  }, 2000);
  let stage: 'execute' | 'finalize' = 'execute';
  try {
    controller.signal.throwIfAborted();
    const result = await executeJob(runtime, job, controller.signal);
    controller.signal.throwIfAborted();
    stage = 'finalize';
    await runtime.jobs.finish(job, result);
  } catch (error) {
    const failure = workerFailure(error);
    const aborted = controller.signal.aborted && (error === controller.signal.reason ||
      failure.category === 'cancelled' || (error instanceof DOMException && error.name === 'AbortError'));
    const interruption = aborted ? controller.signal.reason as JobInterruption : undefined;
    if (interruption?.category === 'heartbeat-failed') {
      reportInterruption(job, 'heartbeat', workerFailure(interruption.cause));
    } else if (interruption) {
      const expected = interruption.category === 'cancelled' || interruption.category === 'shutdown';
      reportInterruption(job, expected ? stage : 'heartbeat', interruption, expected);
    } else {
      reportInterruption(job, stage, failure);
    }
    try {
      await runtime.jobs.finish(job, null, true);
    } catch (settlementError) {
      reportInterruption(job, 'finalize', workerFailure(settlementError));
      throw settlementError;
    }
  }
  finally { clearInterval(timer); shutdown.removeEventListener('abort', stop); }
}

/** Reconcile lost workers, publish pending notifications, and retry identity deletion. */
export async function maintain(runtime: Runtime) {
  const steps: [string, () => Promise<void>][] = [
    ['reconcile', () => runtime.jobs.reconcile()],
    ['dispatch', async () => { if (runtime.dispatcher) await runtime.jobs.dispatch(runtime.dispatch); }],
    ['deletions', () => runtime.accounts.processDeletions(runtime.auth.config.projectId, uid => runtime.auth.deleteUser(uid))],
    ['media', () => pruneMedia(runtime.pool, runtime.objects)],
  ];
  for (const [stage, action] of steps) try { await action(); } catch (error) {
    const code = (error as { code?: string }).code;
    console.error(JSON.stringify({ severity: 'ERROR', message: 'Maintenance stage failed.', stage, code: typeof code === 'string' && /^[a-z0-9/_-]{1,80}$/i.test(code) ? code : 'unclassified', errorType: error instanceof Error ? error.name : 'unknown' }));
    throw error;
  }
}

/** Check local polling readiness; cloud workers intentionally scale to zero. */
export async function pollingReady(pool: Pool) { return Boolean((await pool.query("SELECT 1 FROM worker_heartbeats WHERE seen_at>now()-interval '30 seconds' LIMIT 1")).rowCount); }
