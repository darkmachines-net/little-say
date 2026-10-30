/** @file Attaches origin-bound guest/account credentials to AI and private media without requiring registration. */
import { loadAccountSession } from './accountSession';

/** Use explicit account credentials or establish a guest owner lazily, without enabling backup. */
export async function applicationHeaders(server: string, mutation = false): Promise<Record<string, string>> {
  const session = await loadAccountSession();
  const { accountAuthHeaders, guestAuthHeaders } = await import('./firebaseAccount');
  if (!session || session.server !== server) return guestAuthHeaders(server, mutation);
  return { 'X-Little-Say-Account': session.account.id, ...await accountAuthHeaders(session, mutation) };
}

/** Attach the same origin's AI owner to generated media; reject redirects carrying its credentials. */
export async function mediaRequest(url: string): Promise<RequestInit> {
  const parsed = new URL(url);
  if (!/^\/api\/(speech\/|pictures\/assets\/)/.test(parsed.pathname)) return {};
  return { credentials: 'include', redirect: 'error', headers: await applicationHeaders(parsed.origin) };
}
