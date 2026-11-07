/** @file Binds browser API/media requests to the registered origin using cookies and CSRF, without the identity SDK. */

import { loadAccountSession } from './accountSession';
import { browserCsrfHeaders } from './browserCsrf';

/** Require the saved account's exact server; mutation requests also carry cookie-bound CSRF proof. */
export async function applicationHeaders(server: string, mutation = false): Promise<Record<string, string>> {
  const session = await loadAccountSession();
  if (!session || session.server !== server) throw new Error('Sign in to use Little Say.');
  return { 'X-Little-Say-Account': session.account.id, ...mutation ? await browserCsrfHeaders(server) : {} };
}

/** Authenticate private media only at its saved origin and reject redirects carrying credentials. */
export async function mediaRequest(url: string): Promise<RequestInit> {
  const parsed = new URL(url);
  if (!/^\/api\/(speech\/|pictures\/assets\/)/.test(parsed.pathname)) return {};
  return { credentials: 'include', redirect: 'error', headers: await applicationHeaders(parsed.origin) };
}
