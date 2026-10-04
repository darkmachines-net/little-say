import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { proposalRequestSchema, validateGeneratedBoard, speechRequestSchema, translationRequestSchema, validateTranslations } from '@little-say/core';
import { type AiProvider } from './provider';
import { SpeechCache, SpeechCacheError } from './speech-cache';
import release from '../../../release.json';

export interface ServerOptions { provider: AiProvider | null; speechCache?: SpeechCache; origins?: string[]; webRoot?: string; maxConcurrent?: number; logger?: boolean; }

export async function createServer(options: ServerOptions) {
  const app = Fastify({ bodyLimit: 128 * 1024, logger: options.logger ? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] } : false, disableRequestLogging: true });
  const origins = options.origins ?? ['http://localhost:8081', 'http://localhost:8787', 'http://127.0.0.1:8787'];
  await app.register(cors, { origin: origins, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'X-Little-Say'], credentials: false });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 }, throwFileSizeLimit: true });
  await app.register(rateLimit, { global: false });
  const aiLimits = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  let active = 0;
  const maxConcurrent = options.maxConcurrent ?? 2;
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (request.headers.origin && !origins.includes(request.headers.origin)) return reply.code(403).send({ error: 'This web address is not allowed by the private server.' });
    if (request.method === 'POST' && request.headers['x-little-say'] !== '1') return reply.code(403).send({ error: 'Use the Little Say app to make this request.' });
  });
  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    // Only log metadata, never prompt, transcript, recording, board, or provider error bodies.
    app.log.warn({ requestId: request.id, statusCode: status }, 'Request failed');
    reply.code(status >= 400 && status < 500 ? status : 500).send({ error: status === 413 ? 'This recording is too large. Try a shorter prompt.' : status === 429 ? 'Too many requests. Please try again shortly.' : status === 400 ? 'The request could not be read. Please try again.' : 'The server could not complete this request.' });
  });

  app.get('/api/health', async () => ({ status: 'ok', aiConfigured: options.provider !== null, version: release.version }));
  app.post('/api/speech', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = speechRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Provide up to 200 characters and a valid language for this tile.' });
    if (!options.speechCache) return reply.code(503).send({ error: 'AI speech is not configured. Device speech is still available.' });
    try {
      const { text, language, regenerate } = parsed.data;
      return { text, language, ...await options.speechCache.get({ text, language }, regenerate) };
    } catch (error) {
      return reply.code(error instanceof SpeechCacheError ? error.statusCode : 502).send({ error: error instanceof SpeechCacheError ? error.message : 'Audio could not be generated. Your existing audio and device voice are still available.' });
    }
  });
  app.get<{ Params: { file: string } }>('/api/speech/:file', async (request, reply) => {
    const match = /^([a-f0-9]{64})\.wav$/.exec(request.params.file);
    const audio = match && await options.speechCache?.read(match[1]);
    if (!audio) return reply.code(404).send({ error: 'Audio not found. Generate it again from the tile editor.' });
    return reply.header('Cache-Control', 'private, max-age=31536000, immutable').header('X-Content-Type-Options', 'nosniff').type('audio/wav').send(audio);
  });
  app.post('/api/boards/propose', { ...aiLimits, bodyLimit: 512 * 1024 }, async (request, reply) => {
    const parsed = proposalRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Provide a prompt and a valid board of up to 24 tiles.' });
    if (!options.provider) return reply.code(503).send({ error: 'AI is not configured yet. Add OPENAI_API_KEY on your home server. You can still create and edit boards manually.' });
    if (active >= maxConcurrent) return reply.code(429).send({ error: 'The server is working on another board. Please try again shortly.' });
    active++;
    const start = Date.now();
    try {
      const proposal = validateGeneratedBoard(await options.provider.propose(parsed.data), parsed.data.board);
      app.log.info({ operation: 'propose', durationMs: Date.now() - start }, 'AI request completed');
      return { boardId: parsed.data.board?.id ?? null, baseRevision: parsed.data.board?.revision ?? null, proposal };
    } catch {
      return reply.code(502).send({ error: 'AI could not produce a complete, valid board. Your saved board is unchanged. Try again or simplify the prompt.' });
    } finally { active--; }
  });
  app.post('/api/boards/translate', aiLimits, async (request, reply) => {
    const parsed = translationRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Provide a valid board and up to six target languages per tile.' });
    if (!options.provider?.translate) return reply.code(503).send({ error: 'Translations need AI configured on your server. You can enter translations in each tile editor.' });
    if (active >= maxConcurrent) return reply.code(429).send({ error: 'The server is working on another board. Please try again shortly.' });
    active++;
    try { return validateTranslations(parsed.data, await options.provider.translate(parsed.data)); }
    catch { return reply.code(502).send({ error: 'AI could not prepare all translations. Your board is unchanged. Please try again.' }); }
    finally { active--; }
  });
  app.post('/api/transcribe', aiLimits, async (request, reply) => {
    if (!options.provider) return reply.code(503).send({ error: 'Voice prompts need an OpenAI key configured on your home server. You can type your prompt instead.' });
    if (active >= maxConcurrent) return reply.code(429).send({ error: 'The server is busy. Please try again shortly.' });
    active++;
    try {
      const file = await request.file();
      const mime = file?.mimetype.split(';')[0];
      const extensions: Record<string, string> = { 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };
      if (!file || !mime || !extensions[mime]) return reply.code(400).send({ error: 'Use a supported audio recording (M4A, WebM, MP3, or WAV).' });
      const audio = await file.toBuffer();
      if (audio.length < 100) return reply.code(400).send({ error: 'The recording was empty. Try recording again or type your prompt.' });
      const transcript = (await options.provider.transcribe(audio, `prompt.${extensions[mime]}`, mime)).trim();
      if (!transcript || transcript.length > 4000) return reply.code(422).send({ error: 'No usable short prompt was heard. Try again or type your prompt.' });
      return { text: transcript };
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 413) return reply.code(413).send({ error: 'This recording is too large. Try a shorter prompt.' });
      return reply.code(502).send({ error: 'The recording could not be transcribed. Try again or type your prompt.' });
    } finally { active--; }
  });

  const root = resolve(options.webRoot ?? '../mobile/dist');
  if (existsSync(resolve(root, 'index.html'))) {
    await app.register(staticFiles, { root, setHeaders(response, path) {
      if (path.endsWith('.html') || path.endsWith('sw.js')) response.header('Cache-Control', 'no-cache');
      response.header('X-Content-Type-Options', 'nosniff');
      response.header('Referrer-Policy', 'same-origin');
      response.header('Permissions-Policy', 'microphone=(self), camera=()');
      response.header('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    } });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') || request.url.includes('.') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html'));
  }
  return app;
}
