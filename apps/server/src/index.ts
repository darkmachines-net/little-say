/**
 * @file Loads server environment, wires OpenAI and durable speech caching, and starts the HTTP
 * listener.
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createServer } from './app';
import { openAIProvider } from './provider';
import { SpeechCache } from './speech-cache';
import { openAISynthesis, speechProfile } from './synthesis';
config({ path: resolve(process.cwd(), '../../.env'), quiet: true });
config({ quiet: true });
const app = await createServer({
  provider: openAIProvider(process.env),
  speechCache: new SpeechCache(resolve(process.env.SPEECH_CACHE_DIR || '../../.cache/speech'), speechProfile(process.env), openAISynthesis(process.env, speechProfile(process.env))),
  origins: process.env.ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean),
  webRoot: process.env.WEB_ROOT,
  logger: true,
});
await app.listen({ port: Number(process.env.PORT || 8787), host: process.env.HOST || '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await app.close(); process.exit(0); });
