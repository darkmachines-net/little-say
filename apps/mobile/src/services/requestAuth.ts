/** @file Attaches credentials only to the explicitly signed-in backend and protected application paths. */
import { loadAccountSession } from './accountSession';

/** Resolve current credentials lazily so account configuration/login requests cannot recurse. */
export async function applicationHeaders(server: string, mutation = false): Promise<Record<string, string>> {
  const session = await loadAccountSession();
  if (!session || session.server !== server) return {};
  const { accountAuthHeaders } = await import('./firebaseAccount');
  return { 'X-Little-Say-Account': session.account.id, ...await accountAuthHeaders(session, mutation) };
}

/** Authenticate media only at the signed-in origin; catalog downloads also work signed out. */
export async function mediaRequest(url: string): Promise<RequestInit> {
  const parsed = new URL(url);
  if (!/^\/api\/(speech\/|pictures\/assets\/)/.test(parsed.pathname)) return {};
  return { credentials: 'include', redirect: 'error', headers: await applicationHeaders(parsed.origin) };
}
