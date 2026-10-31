/** @file Exchanges registered account identities for opaque sessions; backups and deletion retain explicit account verification. */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { syncSnapshotSchema } from '@little-say/core';
import { z } from 'zod';
import { Accounts, AccountError, MAX_ASSET_BYTES } from './store';
import { COOKIE_SECONDS, type IdentityService } from './firebase';
import { AccountAccess, sessionCookie, bearerToken as bearer } from './access';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
function setCookie(reply: FastifyReply, value: string, secure: boolean, seconds: number) {
  reply.header('Set-Cookie', '__session=' + value + '; Path=/api; HttpOnly; SameSite=Strict; Max-Age=' + (value ? seconds : 0) + (secure ? '; Secure' : ''));
}
function recent(authTime: number) { if (authTime > Date.now() / 1000 + 60 || Date.now() / 1000 - authTime > 300) throw new AccountError('Authenticate again to complete this action.', 401); }

/** Register optional Firebase account routes; the caller owns the repositories and identity adapter. */
export async function accountRoutes(app: FastifyInstance, accounts: Accounts, auth: IdentityService, secureCookies: boolean) {
  const access = new AccountAccess(accounts, auth);
  const authenticate = (request: FastifyRequest, backup = false) => access.verify(request, backup);
  const csrf = (request: FastifyRequest) => accounts.checkCsrf(sessionCookie(request), request.headers['x-little-say-csrf']);
  await app.register(async routes => {
    routes.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); reply.header('X-Content-Type-Options', 'nosniff'); });
    routes.setErrorHandler((error, _request, reply) => {
      if (error instanceof AccountError) return reply.code(error.statusCode).send({ error: error.message });
      const status = (error as { statusCode?: number }).statusCode;
      return reply.code(status === 429 ? 429 : status === 413 ? 413 : 500).send({ error: status === 429 ? 'Too many attempts. Try again shortly.' : status === 413 ? 'This backup file is too large.' : 'Account service could not complete the request. Your local boards are unchanged.' });
    });
    routes.get('/api/account/config', async () => auth.config);
    routes.get('/api/account/csrf', async (request, reply) => {
      const session = await accounts.browserSession(sessionCookie(request));
      if (session.cookie !== sessionCookie(request)) setCookie(reply, session.cookie, secureCookies, 86400);
      return { csrfToken: session.csrf };
    });
    // This exchanges registered account ID tokens; Firebase owns password attempts.
    routes.post('/api/account/session', { config: { rateLimit: { max: 120, timeWindow: '1 minute', groupId: 'session-exchange' } } }, async (request, reply) => {
      const parsed = z.object({ idToken: z.string().min(1).max(16000), native: z.boolean().default(false) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'A Firebase sign-in token is required.' });
      if (!parsed.data.native) await csrf(request);
      const identity = await auth.verify(parsed.data.idToken);
      if (!identity.providers.length) throw new AccountError('Sign in with a registered account.', 401);
      recent(identity.authTime);
      const account = await accounts.provision(identity);
      if (!parsed.data.native) setCookie(reply, await accounts.issueCookie(account, await auth.cookie(parsed.data.idToken), Math.floor(Date.now() / 1000) + COOKIE_SECONDS, sessionCookie(request)), secureCookies, COOKIE_SECONDS);
      return { account };
    });
    routes.get('/api/account/session', async request => ({ account: (await authenticate(request)).account }));
    routes.post('/api/account/logout', async (request, reply) => {
      const { cookie, identity } = await authenticate(request);
      if (cookie) await accounts.logout(cookie, identity.expires);
      setCookie(reply, '', secureCookies, 0);
      return { ok: true };
    });
    routes.post('/api/account/delete', { config: { rateLimit: { max: 10, timeWindow: '15 minutes', groupId: 'account-auth' } } }, async (request, reply) => {
      if (!bearer(request)) await csrf(request);
      const parsed = z.object({ idToken: z.string().min(1).max(16000), apple: z.object({ token: z.string().min(1).max(16000), type: z.enum(['CODE', 'ACCESS_TOKEN']), redirectUri: z.string().optional() }).optional() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Reauthenticate before deleting your account.' });
      const fresh = await auth.verify(parsed.data.idToken); recent(fresh.authTime);
      const account = await accounts.find(fresh, true);
      if (request.headers['x-little-say-account'] !== account.id) throw new AccountError('Reauthenticate with the same account before deleting it.', 403);
      if (fresh.providers.includes('apple.com') && !parsed.data.apple) throw new AccountError('Reauthenticate with Apple to revoke its authorization before deleting.', 400);
      await accounts.requestDeletion(account, fresh, fresh.providers.includes('apple.com'));
      if (fresh.providers.includes('apple.com')) {
        if (!parsed.data.apple) throw new AccountError('Reauthenticate with Apple to revoke its authorization before deleting.', 400);
        await auth.revokeApple(parsed.data.idToken, parsed.data.apple);
      }
      await accounts.confirmDeletion(fresh);
      setCookie(reply, '', secureCookies, 0);
      return reply.code(202).send({ ok: true, deletionPending: true });
    });
    routes.get('/api/account/backup', async request => accounts.snapshot((await authenticate(request, true)).account));
    routes.post('/api/account/backup', { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
      const { account } = await authenticate(request, true);
      const parsed = syncSnapshotSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'This backup is invalid or exceeds the 500-board limit.' });
      return accounts.save(account, parsed.data);
    });
    routes.get<{ Params: { hash: string } }>('/api/account/assets/:hash', async (request, reply) => {
      const { account } = await authenticate(request, true);
      const hash = hashSchema.safeParse(request.params.hash);
      const bytes = hash.success ? await accounts.asset(account, hash.data) : null;
      return bytes ? { data: bytes.toString('base64') } : reply.code(404).send({ error: 'Backup asset unavailable.' });
    });
    routes.post<{ Params: { hash: string } }>('/api/account/assets/:hash', { bodyLimit: Math.ceil(MAX_ASSET_BYTES * 4 / 3) + 100 }, async (request, reply) => {
      const { account } = await authenticate(request, true);
      const hash = hashSchema.safeParse(request.params.hash);
      const body = z.object({ data: z.string().max(Math.ceil(MAX_ASSET_BYTES * 4 / 3)).regex(/^[a-zA-Z0-9+/]*={0,2}$/) }).safeParse(request.body);
      if (!hash.success || !body.success) return reply.code(400).send({ error: 'Invalid backup asset.' });
      await accounts.putAsset(account, hash.data, Buffer.from(body.data.data, 'base64')); return { ok: true };
    });
  });
}
