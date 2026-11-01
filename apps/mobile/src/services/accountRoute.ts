/** @file Defines authentication modes and recognizes account URLs for entry and migration into unified Settings. */

export type AccountEntryMode = 'login' | 'register' | 'reset' | null;
export type AccountManagementMode = 'backup' | 'sign-in-methods' | 'verify-email' | 'sign-out' | 'delete' | 'link-email' | 'link-google' | 'link-apple';
export type AccountMode = AccountEntryMode | AccountManagementMode;
export type AccountRoute = { mode: AccountMode };

/** Distinguish public authentication forms from signed-in account management pages. */
export function isAccountEntryMode(mode: AccountMode): mode is AccountEntryMode {
  return mode === null || mode === 'login' || mode === 'register' || mode === 'reset';
}

/** Resolve a direct link's parent when there is no app-owned navigation history. */
export function accountParent(mode: AccountMode): AccountMode {
  return mode === 'reset' ? 'login' : mode?.startsWith('link-') ? 'sign-in-methods' : null;
}

/** Read exact current or legacy account URLs; unrelated app pages are not account destinations. */
export function readAccountRoute(pathname: string): AccountRoute | null {
  const match = /^\/app\/(?:settings\/)?account(?:\/(login|register|reset|backup|sign-in-methods|verify-email|sign-out|delete|link-email|link-google|link-apple))?\/?$/.exec(pathname);
  return match ? { mode: match[1] as AccountMode || null } : null;
}

/** Build an authentication or legacy account URL; signed-in navigation uses settingsPath instead. */
export function accountPath(mode: AccountMode): string {
  return '/app/account' + (mode ? `/${mode}` : '');
}
