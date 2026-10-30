/** @file Shares verified owner and browser CSRF enforcement between account, AI, and media APIs. */
import { type FastifyRequest } from 'fastify';
import { Accounts, AccountError } from './store';
import { type IdentityService } from './firebase';

/** Read the only cookie forwarded by Firebase Hosting without accepting legacy client-carried Firebase tokens. */
export function sessionCookie(request: FastifyRequest) { return (request.headers.cookie ?? '').split(';').map(value => value.trim()).find(value => value.startsWith('__session='))?.slice(10) ?? ''; }
/** Extract explicit native bearer authority; a browser cookie never takes precedence over a bearer token. */
export function bearerToken(request: FastifyRequest) { return /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1]; }

/** Applies current Firebase verification, account state, owner expectations, and mutation CSRF checks. */
export class AccountAccess {
  /** Share the caller-owned account and identity repositories. */
  constructor(private accounts: Accounts, private auth: IdentityService) {}
  /** Require an enrolled identity, and optionally a verified email, before protected application work. */
  async verify(request: FastifyRequest, verified = false) {
    const bearer = bearerToken(request), cookie = sessionCookie(request);
    if (!bearer && !cookie) throw new AccountError('Sign in to use AI or cloud backup. Your local boards are still available.', 401);
    if (!bearer && request.method !== 'GET') await this.accounts.checkCsrf(cookie, request.headers['x-little-say-csrf']);
    const identity = await this.auth.verify(bearer ?? await this.accounts.checkCookie(cookie), !bearer);
    const account = await this.accounts.find(identity);
    if (request.headers['x-little-say-account'] && request.headers['x-little-say-account'] !== account.id) throw new AccountError('The account changed. Sign in again.', 401);
    if (verified && !identity.emailVerified) throw new AccountError('Verify your email to use AI or cloud backup.', 403);
    return { account, identity, cookie: bearer ? '' : cookie };
  }
}
