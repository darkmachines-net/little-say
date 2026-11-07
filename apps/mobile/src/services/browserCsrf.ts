/** @file Fetches browser CSRF proof through the shared transient-read retry policy without loading the identity SDK. */

import { requestJson } from './requestJson';

/** Read the cookie's CSRF token from the exact server; retry transient reads within 60 seconds and reject redirects. */
export async function browserCsrfHeaders(server: string): Promise<Record<string, string>> {
  const { response, data } = await requestJson(`${server}/api/account/csrf`, {
    credentials: 'include', redirect: 'error', headers: { 'X-Little-Say': '1' }, signal: AbortSignal.timeout(60000),
  });
  if (!response.ok || typeof data.csrfToken !== 'string' || !data.csrfToken) throw new Error('Could not verify your session. Please sign in again.');
  return { 'X-Little-Say-CSRF': data.csrfToken };
}
