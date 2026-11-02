/** @file Fetches browser session CSRF proof without loading the identity SDK or application API client. */

/** Read the opaque cookie's CSRF token from the exact server; reject redirects and time out after 60 seconds. */
export async function browserCsrfHeaders(server: string): Promise<Record<string, string>> {
  const response = await fetch(`${server}/api/account/csrf`, {
    credentials: 'include', redirect: 'error', headers: { 'X-Little-Say': '1' }, signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (!response.ok || typeof data.csrfToken !== 'string' || !data.csrfToken) throw new Error('Could not verify your session. Please sign in again.');
  return { 'X-Little-Say-CSRF': data.csrfToken };
}
