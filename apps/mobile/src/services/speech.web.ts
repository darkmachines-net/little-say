/** @file Supplies browser voices and cached-audio-first playback through Web Speech. */

import { type Tile, type Settings, type SpeechAsset, LatestSpeechQueue } from '@little-say/core';
import { hybridSpeech } from './hybridSpeech';
import { audioPlayback } from './audioPlayback';
export type Voice = { identifier: string; name: string; language: string; localService?: boolean };
/** Read the browser voice list currently available; return an empty list when Web Speech is unavailable. */
export async function getVoices(): Promise<Voice[]> {
  return (window.speechSynthesis?.getVoices() ?? []).map(v => ({ identifier: v.voiceURI, name: v.name, language: v.lang, localService: v.localService }));
}
/**
 * Prefer the saved voice in the tile language, then exact-locale or base-language matches, favoring
 * local voices when available.
 */
export function matchingVoice(tile: Pick<Tile, 'language'>, voices: Voice[], preferences: Settings['voices']) {
  const base = tile.language.split('-')[0].toLowerCase();
  return voices.find(v => v.identifier === preferences[tile.language] && v.language.split('-')[0].toLowerCase() === base)
    ?? voices.find(v => v.language.toLowerCase() === tile.language.toLowerCase() && v.localService !== false)
    ?? voices.find(v => v.language.split('-')[0].toLowerCase() === base && v.localService !== false)
    ?? voices.find(v => v.language.split('-')[0].toLowerCase() === base);
}
/**
 * Create a queue that finishes the active word and retains only the newest pending tile, honoring the per-language source and otherwise using cached
 * audio before browser TTS. Call stop when leaving playback.
 */
export function speechQueue(voices: Voice[], preferences: Settings['voices'], change: (active: Tile | null, pending: Tile | null) => void, failure: (tile: Tile) => void, asset: (tile: Tile) => SpeechAsset | undefined = () => undefined, source: (language: string) => 'ai' | 'device' = () => 'ai') {
  return new LatestSpeechQueue<Tile>(hybridSpeech({
    speak(tile, done, error) {
      if (!window.speechSynthesis) { error(); return; }
      const utterance = new SpeechSynthesisUtterance(tile.speech);
      const selected = matchingVoice(tile, voices, preferences);
      const native = window.speechSynthesis.getVoices().find(v => v.voiceURI === selected?.identifier);
      if (native) utterance.voice = native;
      utterance.lang = tile.language; utterance.rate = 0.88; utterance.onend = done; utterance.onerror = error;
      window.speechSynthesis.speak(utterance);
    },
    stop() { window.speechSynthesis?.cancel(); },
  }, audioPlayback(), asset, tile => source(tile.language) === 'device'), change, failure);
}
