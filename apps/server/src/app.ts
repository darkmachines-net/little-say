/**
 * @file Builds the Fastify API with input validation, origin checks, request limits, speech/picture
 * services, and optional web hosting.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { proposalRequestSchema, validateGeneratedBoard, speechRequestSchema, translationRequestSchema, validateTranslations, pictureAnalysisRequestSchema, pictureJobRequestSchema, pictureConceptSchema, pictureAssetIdSchema } from '@little-say/core';
import { z } from 'zod';
import { PictureJobs, PictureJobError } from './picture-jobs';
import { searchPictures } from './picture-catalog';
import { type AiProvider } from './provider';
import { SpeechCache, SpeechCacheError } from './speech-cache';
import release from '../../../release.json';
import { type Accounts } from './accounts';
import { type IdentityService } from './firebase';
import { type Pool } from 'pg';
import { checkDatabase } from './database';
import { accountRoutes } from './account-routes';
import { type ChatGptConnections } from './chatgpt';
import { chatGptRoutes, chatGptSession, usesChatGpt } from './chatgpt-routes';
import { ChatGptError } from './chatgpt-oauth';

export interface ServerOptions { provider: AiProvider | null; chatgpt?: ChatGptConnections; accounts?: Accounts; auth?: IdentityService; database?: Pool; secureCookies?: boolean; speechCache?: SpeechCache; pictures?: PictureJobs; origins?: string[]; webRoot?: string; maxConcurrent?: number; logger?: boolean; }

/**
 * Construct and register a server with injected AI, speech, and picture services without opening a listening
 * socket; the caller owns listen and close.
 */
export async function createServer(options: ServerOptions) {
  const app = Fastify({ bodyLimit: 128 * 1024, logger: options.logger ? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] } : false, disableRequestLogging: true });
  const origins = options.origins ?? ['http://localhost:8081', 'http://localhost:8787', 'http://127.0.0.1:8787'];
  await app.register(cors, { origin: origins, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'X-Little-Say', 'Authorization', 'X-Little-Say-Account', 'X-Little-Say-AI', 'X-Little-Say-CSRF'], credentials: true });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 }, throwFileSizeLimit: true });
  await app.register(rateLimit, { global: false });
  const aiLimits = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  let active = 0;
  const maxConcurrent = options.maxConcurrent ?? 2;
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (request.headers.origin && !origins.includes(request.headers.origin)) return reply.code(403).send({ error: 'This web address is not allowed by the private server.' });
    if (request.method === 'POST' && request.headers['x-little-say'] !== '1') return reply.code(403).send({ error: 'Use the Little Say app to make this request.' });
    if (request.method === 'POST' && usesChatGpt(request) && ['/api/speech', '/api/transcribe', '/api/pictures/analyze', '/api/pictures/jobs', '/api/pictures/review'].includes(request.url.split('?')[0])) {
      return reply.code(409).send({ error: 'ChatGPT plan usage covers board drafts and translations. Voice prompts, AI audio, and automatic pictures are unavailable while connected. The server API key was not used.' });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ChatGptError) return reply.code(error.statusCode).send({ error: error.message });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    // Only log metadata, never prompt, transcript, recording, board, or provider error bodies.
    app.log.warn({ requestId: request.id, statusCode: status }, 'Request failed');
    reply.code(status >= 400 && status < 500 ? status : 500).send({ error: status === 413 ? 'This recording is too large. Try a shorter prompt.' : status === 429 ? 'Too many requests. Please try again shortly.' : status === 400 ? 'The request could not be read. Please try again.' : 'The server could not complete this request.' });
  });

  app.get('/api/health', async () => ({ status: 'ok', aiConfigured: options.provider !== null, version: release.version, pictures: { version: 1, catalog: Boolean(options.pictures), analysis: Boolean(options.pictures?.provider), generation: Boolean(options.pictures?.provider && options.pictures.generationEnabled) } }));
  app.get('/api/ready', async (_request, reply) => {
    try { if (options.database) await checkDatabase(options.database); return { status: 'ok', version: release.version }; }
    catch { return reply.code(503).send({ status: 'unavailable', error: 'Database readiness check failed.' }); }
  });
  let deletionWork: Promise<void> | undefined;
  const sweep = () => {
    if (!deletionWork && options.accounts && options.auth) deletionWork = options.accounts.processDeletions(options.auth.config.projectId, uid => options.auth!.deleteUser(uid)).catch(() => { app.log.error('Account deletion retry failed; pending work remains durable.'); }).finally(() => { deletionWork = undefined; });
  };
  const deletionTimer = options.accounts && options.auth ? setInterval(sweep, 30000) : undefined;
  deletionTimer?.unref();
  app.addHook('onReady', async () => { sweep(); });
  app.addHook('onClose', async () => { clearInterval(deletionTimer); await deletionWork; options.pictures?.close(); await options.auth?.close(); await options.database?.end(); });
  await chatGptRoutes(app, options.chatgpt, options.secureCookies ?? true);
  if (options.accounts && options.auth) await accountRoutes(app, options.accounts, options.auth, options.secureCookies ?? true);
  app.get('/api/pictures/search', aiLimits, async (request, reply) => {
    const parsed = z.object({ q: z.string().trim().min(1).max(300), style: z.enum(['color', 'line']) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Provide search words and a picture style.' });
    return { entries: searchPictures(parsed.data.q, parsed.data.style) };
  });
  app.get<{ Params: { id: string } }>('/api/pictures/library/:id', aiLimits, async (request, reply) => {
    if (!options.pictures) return reply.code(503).send({ error: 'The picture library is unavailable.' });
    try { return { picture: (await options.pictures.library(request.params.id)).picture }; }
    catch (error) { return reply.code(error instanceof PictureJobError ? error.statusCode : 502).send({ error: 'This library picture could not be downloaded.' }); }
  });
  app.get<{ Params: { file: string } }>('/api/pictures/assets/:file', async (request, reply) => {
    const match = /^([a-f0-9]{64})\.png$/.exec(request.params.file);
    const bytes = match && await options.pictures?.read(match[1]);
    if (!bytes) return reply.code(404).send({ error: 'Picture unavailable.' });
    return reply.header('Cache-Control', 'private, max-age=31536000, immutable').header('X-Content-Type-Options', 'nosniff').type('image/png').send(bytes);
  });
  app.post('/api/pictures/analyze', aiLimits, async (request, reply) => {
    const parsed = pictureAnalysisRequestSchema.safeParse(request.body);
    if (!parsed.success || new Set(parsed.data.tiles.map(tile => tile.id)).size !== parsed.data.tiles.length) return reply.code(400).send({ error: 'Provide up to 24 distinct cards.' });
    if (!options.pictures?.provider) return reply.code(503).send({ error: 'Automatic picture matching needs AI on the server.' });
    if (active >= maxConcurrent) return reply.code(429).send({ error: 'The server is busy. Try picture matching again shortly.' });
    active++;
    try { return await options.pictures.provider.analyze(parsed.data); }
    catch { return reply.code(502).send({ error: 'Picture meanings could not be checked. Your saved pictures are unchanged.' }); }
    finally { active--; }
  });
  app.post('/api/pictures/jobs', aiLimits, async (request, reply) => {
    const parsed = pictureJobRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Provide a valid picture request.' });
    if (!options.pictures) return reply.code(503).send({ error: 'Picture services are unavailable.' });
    try { return await options.pictures.start(parsed.data); }
    catch (error) { return reply.code(error instanceof PictureJobError ? error.statusCode : 500).send({ error: error instanceof PictureJobError ? error.message : 'Picture work could not start.' }); }
  });
  app.get<{ Params: { id: string } }>('/api/pictures/jobs/:id', async (request, reply) => {
    const job = await options.pictures?.status(request.params.id);
    return job ?? reply.code(404).send({ error: 'Picture request unavailable.' });
  });
  app.post<{ Params: { id: string } }>('/api/pictures/jobs/:id/cancel', aiLimits, async (request, reply) => {
    const job = await options.pictures?.cancel(request.params.id);
    return job ?? reply.code(404).send({ error: 'Picture request unavailable.' });
  });
  app.post('/api/pictures/review', aiLimits, async (request, reply) => {
    const parsed = z.object({ cards: z.array(z.object({ id: z.string().max(100), assetId: pictureAssetIdSchema, concept: pictureConceptSchema })).min(1).max(24) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Provide saved picture IDs and their meanings.' });
    if (!options.pictures || active >= maxConcurrent) return reply.code(503).send({ error: 'Picture review is unavailable. Retry shortly.' });
    active++;
    try { return { rejected: await options.pictures.review(parsed.data.cards) }; }
    catch { return reply.code(502).send({ error: 'Picture review could not finish. Review the draft before saving.' }); }
    finally { active--; }
  });
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
    if (!usesChatGpt(request) && !options.provider) return reply.code(503).send({ error: 'AI is not configured yet. Connect ChatGPT in Parent settings if available, or configure the server API key. You can still create boards manually.' });
    if (active >= maxConcurrent) return reply.code(429).send({ error: 'The server is working on another board. Please try again shortly.' });
    active++;
    const start = Date.now();
    try {
      const provider = usesChatGpt(request) ? await options.chatgpt?.provider(chatGptSession(request)) : options.provider;
      if (!provider) throw new ChatGptError('Reconnect ChatGPT in Parent settings. The server API key was not used.', 401);
      const proposal = validateGeneratedBoard(await provider.propose(parsed.data), parsed.data.board);
      app.log.info({ operation: 'propose', durationMs: Date.now() - start }, 'AI request completed');
      return { boardId: parsed.data.board?.id ?? null, baseRevision: parsed.data.board?.revision ?? null, proposal };
    } catch (error) {
      if (error instanceof ChatGptError) throw error;
      return reply.code(502).send({ error: 'AI could not produce a complete, valid board. Your saved board is unchanged. Try again or simplify the prompt.' });
    } finally { active--; }
  });
  app.post('/api/boards/translate', aiLimits, async (request, reply) => {
    const parsed = translationRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Provide a valid board and up to six target languages per tile.' });
    if (!usesChatGpt(request) && !options.provider?.translate) return reply.code(503).send({ error: 'Translations need AI configured on your server. You can enter translations in each tile editor.' });
    if (active >= maxConcurrent) return reply.code(429).send({ error: 'The server is working on another board. Please try again shortly.' });
    active++;
    try {
      const provider = usesChatGpt(request) ? await options.chatgpt?.provider(chatGptSession(request)) : options.provider;
      if (!provider?.translate) throw new ChatGptError('Reconnect ChatGPT in Parent settings. The server API key was not used.', 401);
      return validateTranslations(parsed.data, await provider.translate(parsed.data));
    }
    catch (error) { if (error instanceof ChatGptError) throw error; return reply.code(502).send({ error: 'AI could not prepare all translations. Your board is unchanged. Please try again.' }); }
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
