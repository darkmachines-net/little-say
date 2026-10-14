/** @file Defines Settings page URLs and deterministic parent navigation for web and native stacks. */

export type SettingsRoute = { page: 'overview' | 'languages' | 'voices' | 'pictures' | 'account' | 'screen-guidance' | 'privacy' | 'updates'; language?: string; mode?: 'login' | 'register' | 'reset' };

/** Read a Settings URL, canonicalizing language tags and returning the overview for unknown children. */
export function readSettingsRoute(pathname: string): SettingsRoute | null {
  if (!/^\/app\/settings(?:\/|$)/.test(pathname)) return null;
  const parts = pathname.replace(/\/+$/, '').split('/').slice(3);
  const page = parts[0] || 'overview';
  if (page === 'voices' && parts[1]) {
    try { return { page, language: Intl.getCanonicalLocales(decodeURIComponent(parts[1]))[0] }; } catch { return { page }; }
  }
  if (page === 'account') return { page, ...(['login', 'register', 'reset'].includes(parts[1]) ? { mode: parts[1] as SettingsRoute['mode'] } : {}) };
  return { page: ['languages', 'voices', 'pictures', 'screen-guidance', 'privacy', 'updates'].includes(page) ? page as SettingsRoute['page'] : 'overview' };
}

/** Build the public web URL for the same logical page used in native navigation. */
export function settingsPath(route: SettingsRoute): string {
  return '/app/settings' + (route.page === 'overview' ? '' : `/${route.page}`) + (route.language ? `/${encodeURIComponent(route.language)}` : route.mode ? `/${route.mode}` : '');
}

/** Find the parent for direct links without app-owned history; null returns to boards. */
export function settingsParent(route: SettingsRoute): SettingsRoute | null {
  if (route.language) return { page: 'voices' };
  if (route.mode) return { page: 'account', ...(route.mode === 'reset' ? { mode: 'login' as const } : {}) };
  return route.page === 'overview' ? null : { page: 'overview' };
}
