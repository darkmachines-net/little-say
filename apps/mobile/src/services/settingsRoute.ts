/** @file Defines unified Settings destinations, account-link compatibility, and logical parent navigation. */

import { isAccountEntryMode, readAccountRoute, type AccountManagementMode } from './accountRoute';

export type SettingsRoute = { page: 'overview' | 'languages' | 'screen-guidance' | 'privacy' | 'updates' | 'about' }
  | { page: 'account'; mode: AccountManagementMode };

/** Read Settings and legacy account links; authentication forms remain outside signed-in Settings. */
export function readSettingsRoute(pathname: string): SettingsRoute | null {
  const account = readAccountRoute(pathname);
  if (account) return account.mode === null ? { page: 'overview' } : isAccountEntryMode(account.mode) ? null : { page: 'account', mode: account.mode };
  if (!/^\/app\/settings(?:\/|$)/.test(pathname)) return null;
  const parts = pathname.replace(/\/+$/, '').split('/').slice(3);
  const page = parts[0] || 'overview';
  if (page === 'backup') return { page: 'account', mode: 'backup' };
  return { page: ['languages', 'screen-guidance', 'privacy', 'updates', 'about'].includes(page) ? page as Exclude<SettingsRoute['page'], 'account'> : 'overview' };
}

/** Build the public web URL for the same logical page used in native navigation. */
export function settingsPath(route: SettingsRoute): string {
  if (route.page === 'account') return route.mode === 'backup' ? '/app/settings/backup' : `/app/settings/account/${route.mode}`;
  return '/app/settings' + (route.page === 'overview' ? '' : `/${route.page}`);
}

/** Find the parent for direct links without app-owned history; null returns to boards. */
export function settingsParent(route: SettingsRoute): SettingsRoute | null {
  if (route.page === 'account' && route.mode.startsWith('link-')) return { page: 'account', mode: 'sign-in-methods' };
  return route.page === 'overview' ? null : { page: 'overview' };
}
