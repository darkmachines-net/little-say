/** @file Routes the shared board workspace, preserving legacy AI links and guarding durable saves. */

import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

type DraftRoute = { boardId: string | null } | null;

function currentRoute(): DraftRoute {
  if (Platform.OS !== 'web') return null;
  if (window.location.hash === '#boards/new') return { boardId: null };
  const match = /^#boards\/([^/]+)\/(?:edit|ai)$/.exec(window.location.hash);
  try { return match ? { boardId: decodeURIComponent(match[1]) } : null; } catch { return null; }
}

/** Restore the shared workspace route on web and defer navigation while a durable save is running. */
export function useBoardDraftRoute() {
  const [route, setRoute] = useState<DraftRoute>(currentRoute);
  const pendingSave = useRef<{ url: string; state: unknown } | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const changed = () => {
      const savedRoute = pendingSave.current;
      if (savedRoute) {
        // Restore synchronously so Back/Forward cannot unmount a draft whose write may fail.
        if (window.location.href !== savedRoute.url) window.history.pushState(savedRoute.state, '', savedRoute.url);
        return;
      }
      setRoute(currentRoute());
    };
    window.addEventListener('popstate', changed); window.addEventListener('hashchange', changed);
    return () => { window.removeEventListener('popstate', changed); window.removeEventListener('hashchange', changed); };
  }, []);
  return {
    route,
    /** Keep the current workspace mounted until a durable save succeeds or reports its error. */
    async save(work: () => Promise<void>) {
      if (Platform.OS === 'web') pendingSave.current = { url: window.location.href, state: window.history.state };
      try { await work(); } finally { pendingSave.current = null; }
    },
    /** Open a board from the library, replacing the current workspace when switching to a copy. */
    open(boardId: string | null = null) {
      if (Platform.OS === 'web') {
        const url = boardId ? `#boards/${encodeURIComponent(boardId)}/edit` : '#boards/new';
        if (route) window.history.replaceState(window.history.state, '', url);
        else window.history.pushState({ ...window.history.state, littleSayDraft: true }, '', url);
      }
      setRoute({ boardId });
    },
    /** Promote an accepted creation draft without remounting the editor or adding a history entry. */
    replace(boardId: string | null) {
      if (Platform.OS === 'web') window.history.replaceState(window.history.state, '', boardId ? `#boards/${encodeURIComponent(boardId)}/edit` : '#boards/new');
      setRoute({ boardId });
    },
    /** Return to the entry page; direct links have no app-owned entry to pop. */
    close() {
      if (pendingSave.current) return;
      setRoute(null);
      if (Platform.OS === 'web') {
        if (window.history.state?.littleSayDraft) { window.history.back(); return; }
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
      }
    },
  };
}
