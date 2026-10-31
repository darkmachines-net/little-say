/** @file Defines preference/help URLs and parent navigation; account pages belong to accountRoute. */

export type SettingsRoute = { page: 'overview' | 'languages' | 'voices' | 'pictures' | 'screen-guidance' | 'privacy' | 'updates' | 'about'; language?: string };

/** Read a Settings URL, canonicalizing language tags and returning the overview for unknown children. */
export function readSettingsRoute(pathname: string): SettingsRoute | null {
  if (!/^\/app\/settings(?:\/|$)/.test(pathname) || /^\/app\/settings\/account(?:\/|$)/.test(pathname)) return null;
  const parts = pathname.replace(/\/+$/, '').split('/').slice(3);
  const page = parts[0] || 'overview';
  if (page === 'voices' && parts[1]) {
    try { return { page, language: Intl.getCanonicalLocales(decodeURIComponent(parts[1]))[0] }; } catch { return { page }; }
  }
  return { page: ['languages', 'voices', 'pictures', 'screen-guidance', 'privacy', 'updates', 'about'].includes(page) ? page as SettingsRoute['page'] : 'overview' };
}

/** Build the public web URL for the same logical page used in native navigation. */
export function settingsPath(route: SettingsRoute): string {
  return '/app/settings' + (route.page === 'overview' ? '' : `/${route.page}`) + (route.language ? `/${encodeURIComponent(route.language)}` : '');
}

/** Find the parent for direct links without app-owned history; null returns to boards. */
export function settingsParent(route: SettingsRoute): SettingsRoute | null {
  if (route.language) return { page: 'voices' };
  return route.page === 'overview' ? null : { page: 'overview' };
}
