/** @file Enforces registered-account ownership and browser CSRF enforcement; only backups require verified email. */
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
  /** Require a registered owner; verified email is reserved for private backup access. */
  async verify(request: FastifyRequest, verified = false) {
    const bearer = bearerToken(request), cookie = sessionCookie(request);
    if (!bearer && !cookie) throw new AccountError('Your session expired. Sign in again. Your local boards are safe.', 401);
    if (!bearer && request.method !== 'GET') await this.accounts.checkCsrf(cookie, request.headers['x-little-say-csrf']);
    const identity = await this.auth.verify(bearer ?? await this.accounts.checkCookie(cookie), !bearer);
    if (!identity.providers.length) throw new AccountError('Sign in with a registered account.', 401);
    const account = await this.accounts.find(identity);
    if (request.headers['x-little-say-account'] && request.headers['x-little-say-account'] !== account.id) throw new AccountError('The account changed. Sign in again.', 401);
    if (verified && !identity.emailVerified) throw new AccountError('Sign in and verify your email to use cloud backup.', 403);
    return { account, identity, cookie: bearer ? '' : cookie };
  }
}
