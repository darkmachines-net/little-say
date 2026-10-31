/** @file Prepares emulator-only test sign-in and starts the authenticated API; migrations and workers own background mutations. */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createServer } from './app';
import { hostedRuntime, apiCaches, pollingReady } from './hosting/runtime';
config({ path: resolve(process.cwd(), '../../.env'), quiet: true }); config({ quiet: true });
const runtime = await hostedRuntime();
await runtime.auth.prepareDevelopmentAccount();
const app = await createServer({ provider: null, ...apiCaches(runtime), accounts: runtime.accounts, auth: runtime.auth, database: runtime.pool,
  hosting: runtime, secureCookies: process.env.NODE_ENV === 'production', origins: process.env.ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean), webRoot: process.env.WEB_ROOT, logger: true });
if (process.env.NODE_ENV !== 'production') app.get('/api/development/ready', async (_request, reply) => {
  const worker = await pollingReady(runtime.pool);
  return reply.code(worker ? 200 : 503).send({ status: worker ? 'ok' : 'unavailable', worker });
});
await app.listen({ port: Number(process.env.PORT || 8787), host: process.env.HOST || '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await app.close(); });
