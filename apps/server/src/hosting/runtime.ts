/** @file Wires shared services for local polling and cloud delivery without process-local durability. */
import { resolve } from 'node:path';
import { type Pool } from 'pg';
import { type ProposalRequest, type TranslationRequest, type PictureAnalysisRequest, type PictureJobRequest, type SpeechInput, validateGeneratedBoard, validateTranslations } from '@little-say/core';
import { createDatabase, checkDatabase } from '../database';
import { Accounts } from '../accounts/store';
import { FirebaseIdentity } from '../accounts/firebase';
import { AccountAccess } from '../accounts/access';
import { openAIProvider } from '../provider';
import { openAIPictureProvider } from '../pictures/provider';
import { PictureJobs } from '../pictures/jobs';
import { SpeechCache } from '../speech-cache';
import { openAISynthesis, speechProfile } from '../synthesis';
import { BoardPreparation } from '../board-preparation';
import { GenericContent } from '../generic-content';
import { DatabaseCache, FileObjects, pruneMedia, type ObjectStore } from './storage';
import { GoogleObjects, GoogleDispatch } from './google';
import { Jobs, type Job } from './jobs';
import { fixtureProviders } from './fixtures';

/** Construct owned resources after checking account, storage, and execution configuration. */
export async function hostedRuntime(env: NodeJS.ProcessEnv = process.env) {
  if (!env.FIREBASE_PROJECT_ID) throw new Error('Configure Firebase and PostgreSQL, or use npm run dev for the local stack.');
  if (env.NODE_ENV === 'production' && env.AAC_AI_FIXTURES === 'true') throw new Error('Fixture AI is forbidden in production.');
  const pool = createDatabase(env);
  try {
    await checkDatabase(pool);
    const auth = new FirebaseIdentity(env), accounts = new Accounts(pool);
    const objects: ObjectStore = env.MEDIA_BUCKET ? new GoogleObjects(env.MEDIA_BUCKET) : new FileObjects(resolve(env.MEDIA_DIRECTORY || '../../.cache/media'));
    const enabled = env.AAC_AI_ENABLED !== 'false' && Boolean(env.AAC_AI_FIXTURES === 'true' || env.AAC_OPENAI_KEY || env.OPENAI_API_KEY || (env.K_SERVICE && env.WORKER_MODE !== 'cloud' && env.AAC_AI_WORKER_CONFIGURED === 'true'));
    const jobs = new Jobs(pool, enabled), access = new AccountAccess(accounts, auth);
    const dispatcher = env.TASKS_QUEUE ? new GoogleDispatch(env.TASKS_QUEUE, env.WORKER_URL || '', env.TASKS_INVOKER || '') : undefined;
    return { pool, auth, accounts, objects, enabled, jobs, access, dispatcher, env,
      /** Dispatch only after job admission; database state survives a lost response. */
      dispatch: async (id: string) => { if (dispatcher) await dispatcher.send(id); },
    };
  } catch (error) { await pool.end(); throw error; }
}
export type Runtime = Awaited<ReturnType<typeof hostedRuntime>>;

/** Build API caches without worker-specific grants or provider credentials. */
export function apiCaches(runtime: Pick<Runtime, 'pool' | 'objects' | 'env'>) {
  return { pictures: new PictureJobs(new DatabaseCache(runtime.pool, runtime.objects, 'pictures'), undefined, runtime.env.AAC_IMAGE_GENERATION !== 'false'),
    speechCache: new SpeechCache(new DatabaseCache(runtime.pool, runtime.objects, 'speech'), speechProfile(runtime.env), null) };
}

/** Execute an already-claimed operation, retaining the request until partial picture work completes. */
export async function executeJob(runtime: Pick<Runtime, 'pool' | 'objects' | 'jobs' | 'env'>, job: Job, signal: AbortSignal) {
  const { pool, objects, jobs, env } = runtime;
  const fixture = env.AAC_AI_FIXTURES === 'true' ? fixtureProviders() : undefined;
  const provider = fixture?.boards ?? openAIProvider(env), pictureProvider = fixture?.pictures ?? openAIPictureProvider(env);
  const pictures = new PictureJobs(new DatabaseCache(pool, objects, 'pictures', job.account_id), pictureProvider, env.AAC_IMAGE_GENERATION !== 'false', 1);
  const speech = new SpeechCache(new DatabaseCache(pool, objects, 'speech', job.account_id), speechProfile(env), fixture?.speech ?? openAISynthesis(env, speechProfile(env)), 1);
  const content = new GenericContent(new DatabaseCache(pool, objects, 'generic-v1'));
  const preparation = provider?.prepare ? new BoardPreparation(new DatabaseCache(pool, objects, `batches/${job.account_id}`), provider, pictures, content, speech, 1) : undefined;
  const cancel = () => preparation?.close(); signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    switch (job.kind) {
      case 'proposal': {
        if (!provider) throw new Error('AI unavailable.');
        const input = { ...job.input as ProposalRequest, preparationId: job.id };
        if (!preparation) return { boardId: input.board?.id ?? null, baseRevision: input.board?.revision ?? null, proposal: validateGeneratedBoard(await provider.propose(input), input.board) };
        const result = await preparation.propose(input); signal.throwIfAborted();
        await jobs.progress(job, result); await preparation.drain(job.id, signal);
        return { ...result, preparation: await preparation.status(job.id) };
      }
      case 'translation': {
        if (!provider?.translate) throw new Error('AI unavailable.');
        const input = job.input as TranslationRequest;
        return validateTranslations(input, await provider.translate(input));
      }
      case 'analysis': {
        if (!pictureProvider) throw new Error('AI unavailable.');
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

/** Heartbeat and finalize a claim; exceptions never automatically repeat provider work. */
export async function runJob(runtime: Runtime, job: Job, shutdown: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(); shutdown.addEventListener('abort', abort, { once: true });
  if (shutdown.aborted) abort();
  let updating = false;
  const timer = setInterval(() => {
    if (updating) return; updating = true;
    void runtime.jobs.heartbeat(job).then(active => { if (!active) abort(); }, abort).finally(() => { updating = false; });
  }, 2000);
  try {
    const result = await executeJob(runtime, job, controller.signal); controller.signal.throwIfAborted();
    await runtime.jobs.finish(job, result);
  } catch {
    console.error(JSON.stringify({ severity: 'ERROR', message: 'AI operation interrupted; automatic provider retry disabled.', jobId: job.id }));
    await runtime.jobs.finish(job, null, true);
  }
  finally { clearInterval(timer); shutdown.removeEventListener('abort', abort); }
}

/** Reconcile lost workers, publish pending notifications, and retry identity deletion. */
export async function maintain(runtime: Runtime) {
  const steps: [string, () => Promise<void>][] = [
    ['reconcile', () => runtime.jobs.reconcile()],
    ['dispatch', async () => { if (runtime.dispatcher) await runtime.jobs.dispatch(id => runtime.dispatcher!.send(id)); }],
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
