/** @file Defines Settings and About URLs, retired media-link fallback, and web/native parent navigation. */

export type SettingsRoute = { page: 'overview' | 'languages' | 'account' | 'screen-guidance' | 'privacy' | 'updates' | 'about'; mode?: 'login' | 'register' | 'reset' };

/** Read a Settings URL, returning the overview for retired Voices/Pictures links and unknown children. */
export function readSettingsRoute(pathname: string): SettingsRoute | null {
  if (!/^\/app\/settings(?:\/|$)/.test(pathname)) return null;
  const parts = pathname.replace(/\/+$/, '').split('/').slice(3);
  const page = parts[0] || 'overview';
  if (page === 'account') return { page, ...(['login', 'register', 'reset'].includes(parts[1]) ? { mode: parts[1] as SettingsRoute['mode'] } : {}) };
  return { page: ['languages', 'screen-guidance', 'privacy', 'updates', 'about'].includes(page) ? page as SettingsRoute['page'] : 'overview' };
}

/** Build the public web URL for the same logical page used in native navigation. */
export function settingsPath(route: SettingsRoute): string {
  return '/app/settings' + (route.page === 'overview' ? '' : `/${route.page}`) + (route.mode ? `/${route.mode}` : '');
}

/** Find the parent for direct links without app-owned history; null returns to boards. */
export function settingsParent(route: SettingsRoute): SettingsRoute | null {
  if (route.mode) return { page: 'account', ...(route.mode === 'reset' ? { mode: 'login' as const } : {}) };
  return route.page === 'overview' ? null : { page: 'overview' };
}
