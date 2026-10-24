/** @file Owns Settings history, native Back handling, and navigation protection during durable saves. */

import { useEffect, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { readSettingsRoute, settingsParent, settingsPath, type SettingsRoute } from './settingsRoute';

/** Use real browser routes or a native page stack, preserving the caller and pending preference writes. */
export function useSettingsRoute() {
  const [route, setRoute] = useState<SettingsRoute | null>(() => Platform.OS === 'web' ? readSettingsRoute(window.location.pathname) : null);
  const current = useRef(route); current.current = route;
  const stack = useRef<(SettingsRoute | null)[]>([]);
  const pending = useRef<{ url?: string; state?: unknown } | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const changed = () => {
      if (pending.current?.url) {
        if (window.location.href !== pending.current.url) window.history.pushState(pending.current.state, '', pending.current.url);
        return;
      }
      setRoute(readSettingsRoute(window.location.pathname));
    };
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  const back = () => {
    if (!current.current || pending.current) return;
    if (Platform.OS === 'web' && window.history.state?.littleSaySettings) { window.history.back(); return; }
    const parent = stack.current.length ? stack.current.pop()! : settingsParent(current.current);
    if (Platform.OS === 'web') window.history.replaceState(null, '', parent ? settingsPath(parent) : '/app');
    setRoute(parent);
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
      if (pending.current) return;
      // Shortcuts from a board or backup banner still have the overview as their visible parent.
      if (!current.current && next.page !== 'overview') {
        if (Platform.OS === 'web') window.history.pushState({ littleSaySettings: true }, '', '/app/settings');
        else stack.current.push(null);
        current.current = { page: 'overview' };
      }
      if (Platform.OS === 'web') window.history.pushState({ littleSaySettings: true }, '', settingsPath(next));
      else stack.current.push(current.current);
      setRoute(next);
    },
    /** Return to the previous page; a direct link falls back to its logical parent. */
    back,
    /** Prevent in-app and browser Back from unmounting a page until its write finishes. */
    async save(work: () => Promise<void>) {
      if (pending.current) return;
      pending.current = Platform.OS === 'web' ? { url: window.location.href, state: window.history.state } : {};
      try { await work(); } finally { pending.current = null; }
    },
  };
}
