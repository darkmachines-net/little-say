/** @file Keeps account forms in browser history while exposing the same destinations to the native welcome screen. */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { accountPath, readAccountRoute, type AccountMode, type AccountRoute } from './accountRoute';

/** Restore direct account links and browser Back/Forward without storing authentication form fields. */
export function useAccountRoute() {
  const [route, setRoute] = useState<AccountRoute | null>(() => Platform.OS === 'web' ? readAccountRoute(window.location.pathname) : null);
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
    /** Show a form or welcome page; launch and successful authentication replace the current entry. */
    open(mode: AccountMode = null, replace = false) {
      if (Platform.OS === 'web') {
        if (replace) window.history.replaceState(null, '', accountPath(mode));
        else window.history.pushState({ littleSayAccount: true }, '', accountPath(mode));
      }
      setRoute({ mode });
    },
    /** Return through form history, falling back to the welcome page for direct links. */
    back() {
      if (Platform.OS === 'web' && window.history.state?.littleSayAccount) { window.history.back(); return; }
      const mode = route?.mode === 'reset' ? 'login' : null;
      if (Platform.OS === 'web') window.history.replaceState(null, '', accountPath(mode));
      setRoute({ mode });
    },
    /** Leave account navigation after the caller has durably saved any web guest choice. */
    close() {
      if (Platform.OS === 'web') window.history.replaceState(null, '', '/app');
      setRoute(null);
    },
  };
}
