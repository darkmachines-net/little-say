/** @file Registers authenticated backup and asset routes plus optional account creation, recovery, and sign-out. */

import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { credentialsSchema, syncSnapshotSchema } from '@little-say/core';
import { z } from 'zod';
import { Accounts, AccountError, MAX_ASSET_BYTES } from './accounts';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const token = (request: FastifyRequest) => request.headers.authorization?.replace(/^Bearer /, '') ?? /(?:^|;\s*)little_say_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie ?? '')?.[1] ?? '';
function cookie(reply: FastifyReply, value: string, secure: boolean) {
  reply.header('Set-Cookie', `little_say_session=${value}; Path=/api/account; HttpOnly; SameSite=Strict; Max-Age=${value ? 90 * 86400 : 0}${secure ? '; Secure' : ''}`);
}

/** Register scoped account routes. Browser sessions use HttpOnly cookies; native sessions use bearer tokens. */
export async function accountRoutes(app: FastifyInstance, accounts: Accounts, secureCookies: boolean) {
  const authenticate = (request: FastifyRequest) => {
    const account = accounts.authenticate(token(request));
    if (request.headers['x-little-say-account'] && request.headers['x-little-say-account'] !== account.id) throw new AccountError('The browser account changed. Sign in again before syncing.', 401);
    return account;
  };
  await app.register(async routes => {
    routes.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); reply.header('X-Content-Type-Options', 'nosniff'); });
    routes.setErrorHandler((error, _request, reply) => {
      if (error instanceof AccountError) return reply.code(error.statusCode).send({ error: error.message });
      const status = (error as { statusCode?: number }).statusCode;
      return reply.code(status === 429 ? 429 : status === 413 ? 413 : 500).send({ error: status === 429 ? 'Too many attempts. Try again shortly.' : status === 413 ? 'This backup file is too large.' : 'Account service could not complete the request. Your local boards are unchanged.' });
    });
    for (const operation of ['register', 'login', 'recover'] as const) {
      routes.post(`/api/account/${operation}`, { config: { rateLimit: { max: 10, timeWindow: '15 minutes', groupId: 'account-auth' } } }, async (request, reply) => {
        const parsed = credentialsSchema.extend({ recoveryCode: z.string().regex(/^[a-f0-9]{48}$/).optional() }).safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Use a 3–40 character account name and a password of 12–128 characters.' });
        const { username, password, native, recoveryCode } = parsed.data;
        const result = operation === 'register' ? await accounts.register(username, password) : operation === 'recover' ? await accounts.recover(username, password, recoveryCode ?? '') : await accounts.login(username, password);
        if (!native) cookie(reply, result.token, secureCookies);
        return { ...result, token: native ? result.token : undefined };
      });
    }
    routes.get('/api/account/session', async request => ({ account: authenticate(request) }));
    routes.post('/api/account/logout', async (request, reply) => {
      authenticate(request); accounts.logout(token(request)); cookie(reply, '', secureCookies); return { ok: true };
    });
    routes.post('/api/account/delete', { config: { rateLimit: { max: 10, timeWindow: '15 minutes', groupId: 'account-auth' } } }, async (request, reply) => {
      const account = authenticate(request);
      const password = z.object({ password: z.string().min(12).max(128) }).safeParse(request.body);
      if (!password.success) return reply.code(400).send({ error: 'Enter your password to delete the account.' });
      const verified = await accounts.login(account.username, password.data.password);
      accounts.delete(verified.account); cookie(reply, '', secureCookies); return { ok: true };
    });
    routes.get('/api/account/backup', async request => accounts.snapshot(authenticate(request)));
    routes.post('/api/account/backup', { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
      const account = authenticate(request);
      const parsed = syncSnapshotSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'This backup is invalid or exceeds the 500-board limit.' });
      return accounts.save(account, parsed.data);
    });
    routes.get<{ Params: { hash: string } }>('/api/account/assets/:hash', async (request, reply) => {
      const account = authenticate(request);
      const hash = hashSchema.safeParse(request.params.hash);
      const bytes = hash.success ? accounts.asset(account, hash.data) : null;
      return bytes ? { data: bytes.toString('base64') } : reply.code(404).send({ error: 'Backup asset unavailable.' });
    });
    routes.post<{ Params: { hash: string } }>('/api/account/assets/:hash', { bodyLimit: Math.ceil(MAX_ASSET_BYTES * 4 / 3) + 100 }, async (request, reply) => {
      const account = authenticate(request);
      const hash = hashSchema.safeParse(request.params.hash);
      const body = z.object({ data: z.string().max(Math.ceil(MAX_ASSET_BYTES * 4 / 3)).regex(/^[a-zA-Z0-9+/]*={0,2}$/) }).safeParse(request.body);
      if (!hash.success || !body.success) return reply.code(400).send({ error: 'Invalid backup asset.' });
      accounts.putAsset(account, hash.data, Buffer.from(body.data.data, 'base64')); return { ok: true };
    });
  });
}
