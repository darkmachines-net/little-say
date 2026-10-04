import * as Speech from 'expo-speech';
import { type Tile, type Settings, type SpeechAsset, LatestSpeechQueue } from '@little-say/core';
import { hybridSpeech } from './hybridSpeech';
import { audioPlayback } from './audioPlayback';

export type Voice = { identifier: string; name: string; language: string; localService?: boolean };
export async function getVoices(): Promise<Voice[]> { return Speech.getAvailableVoicesAsync(); }
export function matchingVoice(tile: Pick<Tile, 'language'>, voices: Voice[], preferences: Settings['voices']) {
  return voices.find(v => v.identifier === preferences[tile.language] && v.language.split('-')[0] === tile.language.split('-')[0])
    ?? voices.find(v => v.language.toLowerCase() === tile.language.toLowerCase() && v.localService !== false)
    ?? voices.find(v => v.language.split('-')[0] === tile.language.split('-')[0] && v.localService !== false)
    ?? voices.find(v => v.language.split('-')[0] === tile.language.split('-')[0]);
}
export function speechQueue(voices: Voice[], preferences: Settings['voices'], change: (active: Tile | null, pending: Tile | null) => void, failure: (tile: Tile) => void, asset: (tile: Tile) => SpeechAsset | undefined = () => undefined) {
  return new LatestSpeechQueue<Tile>(hybridSpeech({
    speak(tile, done, error) {
      const voice = matchingVoice(tile, voices, preferences);
      Speech.speak(tile.speech, { language: tile.language, voice: voice?.identifier, rate: 0.88, onDone: done, onStopped: done, onError: error });
    },
    stop() { void Speech.stop(); },
  }, audioPlayback(), asset), change, failure);
}
