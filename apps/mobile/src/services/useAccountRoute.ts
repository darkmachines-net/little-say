/** @file Keeps account entry and management history, returning authenticated users to Home without waiting for sync. */

import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { accountParent, accountPath, readAccountRoute, type AccountMode, type AccountRoute } from './accountRoute';

/** Restore account links and Back/Forward; history stores destinations only, never credentials. */
export function useAccountRoute() {
  const [route, setRoute] = useState<AccountRoute | null>(() => Platform.OS === 'web' ? readAccountRoute(window.location.pathname) : null);
  const stack = useRef<AccountMode[]>([]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const initial = readAccountRoute(window.location.pathname);
    if (initial) window.history.replaceState(null, '', accountPath(initial.mode));
    const changed = () => setRoute(readAccountRoute(window.location.pathname));
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  return {
    route,
    /** Show an account page; authentication transitions replace the entry and discard native form history. */
    open(mode: AccountMode = null, replace = false) {
      if (Platform.OS === 'web') {
        if (replace) window.history.replaceState(null, '', accountPath(mode));
        else window.history.pushState({ littleSayAccount: true }, '', accountPath(mode));
      }
      if (replace) stack.current = [];
      else if (route) stack.current.push(route.mode);
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
