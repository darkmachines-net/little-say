import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { boardAudioTiles, speechKey, speechResponseSchema, type Library } from '@little-say/core';
import { loadSpeechAssets, saveSpeechAsset } from '../data/storage';
import { ApiError, apiFetch, backendUrl } from './api';
import { SpeechLibrary } from './speechLibrary';

export function useSpeechLibrary(library: Library | null) {
  const reference = useRef<SpeechLibrary | null>(null);
  if (!reference.current) reference.current = new SpeechLibrary({
    load: loadSpeechAssets,
    async generate(input, configured, regenerate) {
      let result: unknown;
      for (let attempt = 0; ; attempt++) {
        try {
          result = await apiFetch(configured, '/api/speech', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, regenerate }),
          }); break;
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 429 || attempt >= 3) throw error;
          await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
        }
      }
      const response = speechResponseSchema.parse(result);
      if (speechKey(response) !== speechKey(input)) throw new Error('The generated audio did not match this tile.');
      return saveSpeechAsset(speechKey(input), response.id, `${backendUrl(configured)}/api/speech/${response.id}.wav`);
    },
  });
  const speech = reference.current;
  useSyncExternalStore(speech.subscribe, speech.snapshot, speech.snapshot);
  useEffect(() => {
    if (!library?.settings.aiConsent || !library.settings.autoSpeech) {
      void speech.prepare([], library?.settings.backendUrl ?? ''); return;
    }
    const prepare = (retry = false) => { void speech.prepare(library.boards.flatMap(boardAudioTiles), library.settings.backendUrl, retry); };
    prepare();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') prepare(true); });
    const online = () => prepare(true);
    if (Platform.OS === 'web') window.addEventListener('online', online);
    return () => { subscription.remove(); if (Platform.OS === 'web') window.removeEventListener('online', online); };
  }, [library, speech]);
  return speech;
}
