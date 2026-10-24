/** @file Combines cached audio playback with system speech fallback under one cancellable driver. */

import { type SpeechAsset, type SpeechDriver, type Tile } from '@little-say/core';

/**
 * Honor device-only choices; otherwise prefer cached clips and fall back to system TTS on failure. One driver feeds
 * the bounded queue for both sources; stop cancels both and invalidates late callbacks.
 */
export function hybridSpeech(system: SpeechDriver<Tile>, audio: SpeechDriver<string>, asset: (tile: Tile) => SpeechAsset | undefined, prefersDevice: (tile: Tile) => boolean = () => false): SpeechDriver<Tile> {
  let generation = 0;
  return {
    /** Play the preferred source, falling back once and ignoring callbacks from cancelled attempts. */
    speak(tile, done, failed) {
      const attempt = ++generation;
      let fallbackStarted = false;
      const finish = () => { if (attempt === generation && !fallbackStarted) { audio.stop(); done(); } };
      const fallback = () => {
        if (attempt !== generation || fallbackStarted) return;
        fallbackStarted = true; audio.stop();
        try { system.speak(tile, () => { if (attempt === generation) done(); }, () => { if (attempt === generation) failed(); }); }
        catch { if (attempt === generation) failed(); }
      };
      const clip = prefersDevice(tile) ? undefined : asset(tile);
      if (!clip) { fallback(); return; }
      try { audio.speak(clip.uri, finish, fallback); } catch { fallback(); }
    },
    /** Stop both drivers and invalidate pending completion or fallback callbacks. */
    stop() { generation++; audio.stop(); system.stop(); },
  };
}
