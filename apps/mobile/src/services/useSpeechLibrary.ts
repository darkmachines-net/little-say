/** @file Plans audio for effective languages and refreshes queue feedback on cooldown and connectivity changes. */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { boardAudioTiles, boardWithProfileLanguages, speechKey, speechResponseSchema, speechSource, type Library } from '@little-say/core';
import { loadSpeechAssets, saveSpeechAsset } from '../data/storage';
import { SpeechAdmissionError, apiFetch, backendUrl } from './api';
import { SpeechLibrary } from './speechLibrary';

/**
 * Prepare missing clips only for languages using AI speech, independent of legacy AI consent.
 * Resolve effective user and board languages, resume rejected admissions after their cooldown, and
 * defer submissions while the browser is offline. Dispose of pending automatic jobs on unmount.
 */
export function useSpeechLibrary(library: Library | null) {
  const reference = useRef<SpeechLibrary | null>(null);
  if (!reference.current) reference.current = new SpeechLibrary({
    load: loadSpeechAssets,
    /** Old servers can reject admission without a hint. Give their rolling minute time to clear. */
    admissionDelay: error => error instanceof SpeechAdmissionError ? (error.retryAfterMs ?? 60_000) : undefined,
    /** Browser offline state is known before attempting a POST. Native relies on the request result. */
    isOnline: () => Platform.OS !== 'web' || typeof navigator === 'undefined' || navigator.onLine !== false,
    /** Send one submission. Accepted work is read via job polling inside apiFetch. */
    async generate(input, configured, regenerate) {
      const result = await apiFetch(configured, '/api/speech', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, regenerate }),
      });
      const response = speechResponseSchema.parse(result);
      if (speechKey(response) !== speechKey(input)) throw new Error('The generated audio did not match this tile.');
      return saveSpeechAsset(speechKey(input), response.id, `${backendUrl(configured)}/api/speech/${response.id}.wav`);
    },
  });
  const speech = reference.current;
  useSyncExternalStore(speech.subscribe, speech.snapshot, speech.snapshot);
  useEffect(() => () => { void speech.prepare([], ''); }, [speech]);
  useEffect(() => {
    if (!library || library.setup) {
      void speech.prepare([], library?.settings.backendUrl ?? ''); return;
    }
    const prepare = () => { void speech.prepare(library.boards.flatMap(board => boardAudioTiles(boardWithProfileLanguages(board, library.settings))).filter(tile => speechSource(library.settings, tile.language) === 'ai'), library.settings.backendUrl); };
    prepare();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') prepare(); });
    if (Platform.OS === 'web') { window.addEventListener('online', prepare); window.addEventListener('offline', prepare); }
    return () => { subscription.remove(); if (Platform.OS === 'web') { window.removeEventListener('online', prepare); window.removeEventListener('offline', prepare); } };
  }, [library, speech]);
  return speech;
}
