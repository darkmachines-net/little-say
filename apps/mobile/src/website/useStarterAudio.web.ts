/** @file Loads the public starter clip index without blocking boards, generating audio, or accessing account state. */

import { useCallback, useEffect, useState } from 'react';
import type { SpeechAsset, Tile } from '@little-say/core';

/** Fetch cached pronunciations once per trial mount; abort on exit and silently retain device speech on any failure. */
export function useStarterAudio() {
  const [clips, setClips] = useState<Map<string, SpeechAsset>>(() => new Map());
  useEffect(() => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 5000);
    void fetch('/api/starter-boards/audio', { credentials: 'omit', redirect: 'error', signal: abort.signal }).then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      if (!Array.isArray(data.clips) || abort.signal.aborted) return;
      const prepared = new Map<string, SpeechAsset>();
      for (const clip of data.clips) {
        if (clip && typeof clip.text === 'string' && clip.language === 'en-US' && typeof clip.id === 'string' && /^[a-f0-9]{64}$/.test(clip.id)) {
          prepared.set(clip.text, { id: clip.id, uri: `/api/starter-boards/audio/${clip.id}.wav` });
        }
      }
      setClips(prepared);
    }).catch(() => {}).finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); abort.abort(); };
  }, []);
  return useCallback((tile: Tile) => tile.language === 'en-US' ? clips.get(tile.speech) : undefined, [clips]);
}
