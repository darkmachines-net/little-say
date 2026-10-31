/** @file Defines account destinations independently of Settings, including redirects for older account links. */

export type AccountMode = 'login' | 'register' | 'reset' | null;
export type AccountRoute = { mode: AccountMode };

/** Read current or legacy account URLs; unrelated app pages are not account destinations. */
export function readAccountRoute(pathname: string): AccountRoute | null {
  const match = /^\/app\/(?:settings\/)?account(?:\/(login|register|reset))?\/?$/.exec(pathname);
  return match ? { mode: match[1] as AccountMode || null } : null;
}

/** Build the canonical account URL used by header actions and browser history. */
export function accountPath(mode: AccountMode): string {
  return '/app/account' + (mode ? `/${mode}` : '');
}
