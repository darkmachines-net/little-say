/** @file Keeps authentication form history separate from signed-in Settings and returns successful sign-ins to Home. */

import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { accountParent, accountPath, isAccountEntryMode, readAccountRoute, type AccountEntryMode, type AccountRoute } from './accountRoute';

function readEntryRoute(pathname: string): AccountRoute | null {
  const route = readAccountRoute(pathname);
  return route && route.mode !== null && isAccountEntryMode(route.mode) ? route : null;
}

/** Restore authentication links and Back/Forward; signed-in management is owned by useSettingsRoute. */
export function useAccountRoute() {
  const [route, setRoute] = useState<AccountRoute | null>(() => Platform.OS === 'web' ? readEntryRoute(window.location.pathname) : null);
  const stack = useRef<AccountEntryMode[]>([]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const initial = readEntryRoute(window.location.pathname);
    if (initial) window.history.replaceState(null, '', accountPath(initial.mode));
    const changed = () => setRoute(readEntryRoute(window.location.pathname));
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  return {
    route,
    /** Open an authentication form; replacement discards native form history without storing credentials. */
    open(mode: AccountEntryMode = null, replace = false) {
      if (Platform.OS === 'web') {
        if (replace) window.history.replaceState(null, '', accountPath(mode));
        else window.history.pushState({ littleSayAccount: true }, '', accountPath(mode));
      }
      if (replace) stack.current = [];
      else if (route && isAccountEntryMode(route.mode)) stack.current.push(route.mode);
      setRoute({ mode });
    },
    /** Return through owned history, or to the logical parent when entering through a direct link. */
    back() {
      if (Platform.OS === 'web' && window.history.state?.littleSayAccount) { window.history.back(); return; }
      const mode = Platform.OS !== 'web' && stack.current.length ? stack.current.pop()! : accountParent(route?.mode ?? null);
      if (Platform.OS === 'web') window.history.replaceState(null, '', accountPath(mode));
      setRoute({ mode });
    },
    /** Return to Home without waiting for sync, notifying other web route owners so prior direct links cannot remain visible. */
    close() {
      if (Platform.OS === 'web') {
        window.history.replaceState(null, '', '/app');
        window.dispatchEvent(new Event('popstate'));
      }
      stack.current = [];
      setRoute(null);
    },
  };
}
