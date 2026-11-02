/** @file Owns unified Settings history, legacy account redirects, and navigation protection during saves and account actions. */

import { useEffect, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { readSettingsRoute, settingsParent, settingsPath, type SettingsRoute } from './settingsRoute';

/** Preserve the caller in browser/native history, blocking navigation during preference writes or account mutations. */
export function useSettingsRoute(navigationBusy = false) {
  const [route, setRoute] = useState<SettingsRoute | null>(() => Platform.OS === 'web' ? readSettingsRoute(window.location.pathname) : null);
  const current = useRef(route); current.current = route;
  const stack = useRef<(SettingsRoute | null)[]>([]);
  const pending = useRef<{ url?: string; state?: unknown } | null>(null);
  const blocked = useRef(navigationBusy); blocked.current = navigationBusy;
  const guardedLocation = useRef<{ url: string; state: unknown } | null>(null);
  if (Platform.OS === 'web' && route && !navigationBusy) guardedLocation.current = { url: window.location.href, state: window.history.state };
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const initial = readSettingsRoute(window.location.pathname);
    if (initial && window.location.pathname !== settingsPath(initial)) window.history.replaceState(window.history.state, '', settingsPath(initial));
    const changed = () => {
      const guard = pending.current?.url ? pending.current : blocked.current ? guardedLocation.current : null;
      if (guard?.url) {
        if (window.location.href !== guard.url) window.history.pushState(guard.state, '', guard.url);
        return;
      }
      setRoute(readSettingsRoute(window.location.pathname));
    };
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  const back = () => {
    if (!current.current || pending.current || blocked.current) return;
    if (Platform.OS === 'web' && window.history.state?.littleSaySettings) { window.history.back(); return; }
    const parent = stack.current.length ? stack.current.pop()! : settingsParent(current.current);
    if (Platform.OS === 'web') window.history.replaceState(null, '', parent ? settingsPath(parent) : '/app');
    current.current = parent; setRoute(parent);
  };
  const onBack = useRef(back); onBack.current = back;
  const settingsOpen = Boolean(route);
  useEffect(() => {
    if (!settingsOpen) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { onBack.current(); return true; });
    return () => listener.remove();
  }, [settingsOpen]);
  return {
    route,
    /** Enter a child page, retaining browser history or the exact native caller. */
    open(next: SettingsRoute = { page: 'overview' }) {
      if (pending.current || blocked.current) return;
      // Shortcuts from a board or backup banner still have the overview as their visible parent.
      if (!current.current && next.page !== 'overview') {
        if (Platform.OS === 'web') window.history.pushState({ littleSaySettings: true }, '', '/app/settings');
        else stack.current.push(null);
        current.current = { page: 'overview' };
      }
      if (Platform.OS === 'web') window.history.pushState({ littleSaySettings: true }, '', settingsPath(next));
      else stack.current.push(current.current);
      current.current = next; setRoute(next);
    },
    /** Return to the previous page; a direct link falls back to its logical parent. */
    back,
    /** Discard Settings history after authentication so native sessions also resume at Home. */
    reset() {
      stack.current = []; current.current = null; guardedLocation.current = null; setRoute(null);
    },
    /** Prevent in-app and browser Back from unmounting a page until its write finishes. */
    async save(work: () => Promise<void>) {
      if (pending.current) return;
      pending.current = Platform.OS === 'web' ? { url: window.location.href, state: window.history.state } : {};
      try { await work(); } finally { pending.current = null; }
    },
  };
}
