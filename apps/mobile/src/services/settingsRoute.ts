/** @file Defines Settings and About URLs with retired media fallback; standalone accounts belong to accountRoute. */

export type SettingsRoute = { page: 'overview' | 'languages' | 'screen-guidance' | 'privacy' | 'updates' | 'about' };

/** Read a Settings URL, returning the overview for retired Voices/Pictures links and unknown children. */
export function readSettingsRoute(pathname: string): SettingsRoute | null {
  if (!/^\/app\/settings(?:\/|$)/.test(pathname) || /^\/app\/settings\/account(?:\/|$)/.test(pathname)) return null;
  const parts = pathname.replace(/\/+$/, '').split('/').slice(3);
  const page = parts[0] || 'overview';
  return { page: ['languages', 'screen-guidance', 'privacy', 'updates', 'about'].includes(page) ? page as SettingsRoute['page'] : 'overview' };
}

/** Build the public web URL for the same logical page used in native navigation. */
export function settingsPath(route: SettingsRoute): string {
  return '/app/settings' + (route.page === 'overview' ? '' : `/${route.page}`);
}

/** Find the parent for direct links without app-owned history; null returns to boards. */
export function settingsParent(route: SettingsRoute): SettingsRoute | null {
  return route.page === 'overview' ? null : { page: 'overview' };
}
