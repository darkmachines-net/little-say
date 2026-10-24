/**
 * @file Loads server environment, wires OpenAI and durable speech/picture caches, and starts the HTTP
 * listener. Firebase configuration enables Postgres-backed accounts and a schema check before listen;
 * guest-only startup creates no pool. Migrations are an explicit operator command, never startup work.
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createServer } from './app';
import { openAIProvider } from './provider';
import { SpeechCache } from './speech-cache';
import { openAISynthesis, speechProfile } from './synthesis';
import { PictureJobs } from './pictures/jobs';
import { openAIPictureProvider } from './pictures/provider';
import { Accounts } from './accounts/store';
import { createDatabase, checkDatabase } from './database';
import { FirebaseIdentity } from './accounts/firebase';
config({ path: resolve(process.cwd(), '../../.env'), quiet: true });
config({ quiet: true });
const accountsEnabled = Boolean(process.env.FIREBASE_PROJECT_ID || process.env.FIREBASE_AUTH_EMULATOR_HOST);
const database = accountsEnabled ? createDatabase() : undefined;
try { if (database) await checkDatabase(database); } catch { await database?.end(); throw new Error('Postgres is unavailable or its schema is incompatible. Check configuration and run db:migrate.'); }
let auth: FirebaseIdentity | undefined;
let app: Awaited<ReturnType<typeof createServer>> | undefined;
try {
  auth = accountsEnabled ? new FirebaseIdentity() : undefined;
  app = await createServer({
  database,
  auth,
  provider: openAIProvider(process.env),
  accounts: auth && database ? new Accounts(database) : undefined,
  secureCookies: process.env.NODE_ENV === 'production',
  pictures: new PictureJobs(resolve(process.env.PICTURE_CACHE_DIR || '../../.cache/pictures'), openAIPictureProvider(process.env, metric => console.info(JSON.stringify({ service: 'pictures', ...metric }))), process.env.AAC_IMAGE_GENERATION !== 'false'),
  speechCache: new SpeechCache(resolve(process.env.SPEECH_CACHE_DIR || '../../.cache/speech'), speechProfile(process.env), openAISynthesis(process.env, speechProfile(process.env))),
  origins: process.env.ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean),
  webRoot: process.env.WEB_ROOT,
  logger: true,
});
await app.listen({ port: Number(process.env.PORT || 8787), host: process.env.HOST || '127.0.0.1' });
} catch {
  if (app) await app.close();
  else { await auth?.close(); await database?.end(); }
  throw new Error('Server startup failed. Check sanitized database, Firebase, and server configuration.');
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await app!.close(); process.exit(0); });
