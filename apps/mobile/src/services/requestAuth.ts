/** @file Requires registered, origin-bound account credentials for AI and private media. */
import { loadAccountSession } from './accountSession';

/** Require a saved account for this origin; missing sign-in never creates an anonymous identity. */
export async function applicationHeaders(server: string, mutation = false): Promise<Record<string, string>> {
  const session = await loadAccountSession();
  const { accountAuthHeaders } = await import('./firebaseAccount');
  if (!session || session.server !== server) throw new Error('Sign in to use Little Say.');
  return { 'X-Little-Say-Account': session.account.id, ...await accountAuthHeaders(session, mutation) };
}

/** Attach the same origin's AI owner to generated media; reject redirects carrying its credentials. */
export async function mediaRequest(url: string): Promise<RequestInit> {
  const parsed = new URL(url);
  if (!/^\/api\/(speech\/|pictures\/assets\/)/.test(parsed.pathname)) return {};
  return { credentials: 'include', redirect: 'error', headers: await applicationHeaders(parsed.origin) };
}
