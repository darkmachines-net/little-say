/** @file Resolves packaged starter pronunciations synchronously, without server configuration, storage, or audio preloading. */

import type { SpeechAsset, Tile } from '@little-say/core';
import manifest from './manifest.json';

const clips = new Map(manifest.clips.map(clip => [JSON.stringify([clip.text, clip.language]), {
  id: clip.id, uri: `/starter-audio/${clip.id}.wav`,
}]));

/** Return the exact bundled words/language clip; the shared player fetches it on tap and handles device-speech fallback. */
export function starterAudioAsset(tile: Tile): SpeechAsset | undefined {
  return clips.get(JSON.stringify([tile.speech, tile.language]));
}
