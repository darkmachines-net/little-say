/** @file Gives the board workspace a full-screen route with browser history and native state navigation. */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

type DraftRoute = { boardId: string | null } | null;

function currentRoute(): DraftRoute {
  if (Platform.OS !== 'web') return null;
  if (window.location.hash === '#boards/new') return { boardId: null };
  const match = /^#boards\/([^/]+)\/ai$/.exec(window.location.hash);
  try { return match ? { boardId: decodeURIComponent(match[1]) } : null; } catch { return null; }
}

/** Open a dedicated workspace, restore its source on web reload, and let browser Back dismiss it. Unsaved drafts remain in memory. */
export function useBoardDraftRoute() {
  const [route, setRoute] = useState<DraftRoute>(currentRoute);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const changed = () => setRoute(currentRoute());
    window.addEventListener('popstate', changed); window.addEventListener('hashchange', changed);
    return () => { window.removeEventListener('popstate', changed); window.removeEventListener('hashchange', changed); };
  }, []);
  return {
    route,
    /** Push a source-specific history entry; native uses the same in-app page without a URL. */
    open(boardId: string | null = null) {
      if (Platform.OS === 'web') window.history.pushState({ ...window.history.state, littleSayDraft: true }, '', boardId ? `#boards/${encodeURIComponent(boardId)}/ai` : '#boards/new');
      setRoute({ boardId });
    },
    /** Return to the entry page; direct links have no app-owned entry to pop. */
    close() {
      if (Platform.OS === 'web') {
        if (window.history.state?.littleSayDraft) { window.history.back(); return; }
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
      }
      setRoute(null);
    },
  };
}
