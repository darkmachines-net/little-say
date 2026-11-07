/** @file Uses the ordinary speech library and endpoints for anonymous cache-only starter playback, with disposable client state. */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { speechKey, speechResponseSchema } from '@little-say/core/speech';
import type { Board } from '@little-say/core';
import { SpeechLibrary } from '../services/speechLibrary';
import { requestJson } from '../services/requestJson';

/** Prepare starter cache hits through the shared speech library; omit credentials so missing clips cannot start paid work. */
export function useTrialSpeech(boards: Board[]) {
  const reference = useRef<SpeechLibrary | null>(null);
  if (!reference.current) reference.current = new SpeechLibrary({
    /** Guest playback starts with an empty transient index and never reads the saved device library. */
    load: async () => ({}),
    /** Resolve a public cache hit via the normal speech endpoint; failures retain the player's device fallback. */
    async generate(input) {
      const { response, data } = await requestJson('/api/speech', {
        method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json', 'X-Little-Say': '1' }, body: JSON.stringify({ ...input, regenerate: false }),
      });
      if (!response.ok) throw new Error('Starter audio unavailable.');
      const clip = speechResponseSchema.parse(data);
      if (speechKey(clip) !== speechKey(input) || !clip.cacheHit) throw new Error('Starter audio did not match.');
      return { id: clip.id, uri: `/api/speech/${clip.id}.wav` };
    },
  });
  const speech = reference.current;
  useSyncExternalStore(speech.subscribe, speech.snapshot, speech.snapshot);
  useEffect(() => {
    void speech.prepare(boards.flatMap(board => board.tiles), '');
    return () => { void speech.prepare([], ''); };
  }, [boards, speech]);
  return speech;
}
