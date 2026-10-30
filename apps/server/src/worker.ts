/** @file Runs the same claimed-job executor through local PostgreSQL polling or private Cloud Run delivery. */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import { hostedRuntime, maintain, runJob } from './hosting/runtime';
import { checkDatabase } from './database';
import release from '../../../release.json';
config({ path: resolve(process.cwd(), '../../.env'), quiet: true }); config({ quiet: true });
const runtime = await hostedRuntime(), shutdown = new AbortController(), workerId = process.env.HOSTNAME || randomUUID();
const active = new Set<Promise<void>>();
const app = Fastify({ logger: false });
app.setErrorHandler((_error, _request, reply) => {
  console.error(JSON.stringify({ severity: 'ERROR', message: 'Worker request failed; durable work remains recoverable.' }));
  return reply.code(503).send({ status: 'unavailable' });
});
app.get('/health', async (_request, reply) => {
  try { await checkDatabase(runtime.pool); return { status: 'ok', version: release.version, revision: process.env.K_REVISION }; }
  catch { return reply.code(503).send({ status: 'unavailable' }); }
});
app.post('/internal/maintenance', async () => { await maintain(runtime); return { status: 'ok' }; });
app.post<{ Params: { id: string } }>('/internal/jobs/:id', async (request, reply) => {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(request.params.id)) return reply.code(400).send({ error: 'Invalid job.' });
  const job = await runtime.jobs.claim(request.params.id);
  if (!job) {
    const pending = (await runtime.pool.query("SELECT 1 FROM ai_jobs WHERE id=$1 AND state='queued'", [request.params.id])).rowCount;
    return reply.code(pending ? 429 : 200).send({ status: pending ? 'busy' : 'settled' });
  }
  const work = runJob(runtime, job, shutdown.signal); active.add(work);
  try { await work; return { status: 'settled' }; } finally { active.delete(work); }
});
if (process.env.WORKER_MODE === 'cloud') {
  if (process.env.NODE_ENV !== 'production' || !process.env.K_SERVICE) throw new Error('Cloud worker endpoints require IAM-protected Cloud Run.');
  await app.listen({ port: Number(process.env.PORT || 8787), host: '0.0.0.0' });
} else {
  void (async () => {
    let maintenance = 0;
    while (!shutdown.signal.aborted) {
      try {
        await runtime.jobs.workerSeen(workerId);
        if (Date.now() - maintenance > 15000) { await maintain(runtime); maintenance = Date.now(); }
        while (active.size < 2) {
          const job = await runtime.jobs.claim(); if (!job) break;
          const work = runJob(runtime, job, shutdown.signal)
            .catch(() => { console.error(JSON.stringify({ severity: 'ERROR', message: 'Job settlement failed; interrupted work will not be replayed.' })); })
            .finally(() => active.delete(work)); active.add(work);
        }
      } catch { console.error('Worker dependency check failed; durable work remains pending.'); }
      await delay(500, undefined, { signal: shutdown.signal }).catch(() => {});
    }
  })();
}
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, async () => {
  if (closing) return; closing = true; shutdown.abort();
  await app.close(); await Promise.allSettled(active); await runtime.auth.close(); await runtime.pool.end();
});
