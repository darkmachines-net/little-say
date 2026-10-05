/** @file Exposes browser-only ChatGPT connection settings and a state-checked OAuth callback without returning OpenAI credentials. */

import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { type ChatGptConnections } from './chatgpt';
import { ChatGptError } from './chatgpt-oauth';

const sessionCookie = 'little_say_chatgpt';
const transactionCookie = 'little_say_chatgpt_pending';
function readCookie(request: FastifyRequest, name: string) {
  return new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]{64})(?:;|$)`).exec(request.headers.cookie ?? '')?.[1] ?? '';
}
function cookie(reply: FastifyReply, name: string, value: string, secure: boolean, age: number) {
  reply.header('Set-Cookie', `${name}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${value ? age : 0}${secure ? '; Secure' : ''}`);
}
/** Read the opaque first-party browser session; native app bearer tokens belong to a separate account service. */
export function chatGptSession(request: FastifyRequest) { return readCookie(request, sessionCookie); }
/** A remembered explicit selection remains binding even when its session expires or cookies are cleared. */
export function usesChatGpt(request: FastifyRequest) { return Boolean(chatGptSession(request) || request.headers['x-little-say-ai'] === 'chatgpt'); }

/** Register status even when disabled; enable OAuth only with the administrator's approved hosted-client configuration. */
export async function chatGptRoutes(app: FastifyInstance, connections: ChatGptConnections | undefined, secure: boolean) {
  await app.register(async routes => {
    routes.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); reply.header('Referrer-Policy', 'no-referrer'); });
    routes.get('/api/chatgpt/status', async request => connections ? connections.status(chatGptSession(request)) : { available: false, selected: usesChatGpt(request), connected: false, planEnabled: false, needsLogin: usesChatGpt(request), welcome: false });
    routes.post('/api/chatgpt/connect', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
      if (!connections) throw new ChatGptError('ChatGPT connection is not enabled on this server.', 503);
      if (request.headers.origin !== new URL(connections.config.redirectUri).origin) throw new ChatGptError('Open Little Say at its registered website address to connect ChatGPT.', 403);
      const pending = await connections.start(chatGptSession(request));
      cookie(reply, transactionCookie, pending.binding, secure, 600);
      return { url: pending.url };
    });
    routes.get('/api/chatgpt/callback', async (request, reply) => {
      cookie(reply, transactionCookie, '', secure, 0);
      try {
        if (!connections) throw new ChatGptError('ChatGPT connection is unavailable.', 503);
        const query = z.object({ code: z.string().max(4096).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional(), client_id: z.string().max(200).optional() }).parse(request.query);
        const session = await connections.complete(readCookie(request, transactionCookie), query);
        // A long-lived selection cookie prevents a database/session expiry from changing billing silently.
        reply.removeHeader('Set-Cookie');
        reply.header('Set-Cookie', [ `${transactionCookie}=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`, `${sessionCookie}=${session}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}` ]);
        return reply.redirect('/app?chatgpt=connected');
      } catch { return reply.redirect('/app?chatgpt=error'); }
    });
    routes.post('/api/chatgpt/acknowledge', async request => { await connections?.acknowledge(chatGptSession(request)); return { ok: true }; });
    routes.post('/api/chatgpt/disconnect', async (request, reply) => {
      const result = await connections?.disconnect(chatGptSession(request));
      cookie(reply, sessionCookie, '', secure, 0);
      return { revoked: result?.revoked ?? false };
    });
  });
}
