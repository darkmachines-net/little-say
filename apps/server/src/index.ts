/**
 * @file Loads server environment, wires OpenAI and durable speech/picture caches, and starts the HTTP
 * listener.
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createServer } from './app';
import { openAIProvider } from './provider';
import { SpeechCache } from './speech-cache';
import { openAISynthesis, speechProfile } from './synthesis';
import { PictureJobs } from './picture-jobs';
import { openAIPictureProvider } from './picture-provider';
import { chatGptConfig, ChatGptConnections } from './chatgpt';
config({ path: resolve(process.cwd(), '../../.env'), quiet: true });
config({ quiet: true });
const chatgpt = chatGptConfig(process.env);
const app = await createServer({
  chatgpt: chatgpt ? new ChatGptConnections(chatgpt) : undefined,
  secureCookies: process.env.NODE_ENV === 'production',
  provider: openAIProvider(process.env),
  pictures: new PictureJobs(resolve(process.env.PICTURE_CACHE_DIR || '../../.cache/pictures'), openAIPictureProvider(process.env, metric => console.info(JSON.stringify({ service: 'pictures', ...metric }))), process.env.AAC_IMAGE_GENERATION !== 'false'),
  speechCache: new SpeechCache(resolve(process.env.SPEECH_CACHE_DIR || '../../.cache/speech'), speechProfile(process.env), openAISynthesis(process.env, speechProfile(process.env))),
  origins: process.env.ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean),
  webRoot: process.env.WEB_ROOT,
  logger: true,
});
await app.listen({ port: Number(process.env.PORT || 8787), host: process.env.HOST || '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await app.close(); process.exit(0); });
