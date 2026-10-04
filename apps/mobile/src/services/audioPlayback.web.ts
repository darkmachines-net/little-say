/** @file Adapts browser audio elements to the shared speech-driver contract. */

import { type SpeechDriver } from '@little-say/core';

/**
 * Create a clip driver that starts playback synchronously to retain user activation; stop detaches
 * handlers and releases the audio source.
 */
export function audioPlayback(): SpeechDriver<string> {
  let cleanup: (() => void) | undefined;
  const stop = () => { const dispose = cleanup; cleanup = undefined; dispose?.(); };
  return {
    speak(uri, done, failed) {
      stop();
      const player = new Audio(uri);
      let active = true;
      const timeout = setTimeout(() => { if (active) failed(); }, 3000);
      player.onplaying = () => clearTimeout(timeout);
      player.onended = () => { if (active) done(); };
      player.onerror = () => { if (active) failed(); };
      cleanup = () => {
        active = false; clearTimeout(timeout);
        player.onended = null; player.onerror = null; player.onplaying = null;
        player.pause(); player.removeAttribute('src'); player.load();
      };
      // Start synchronously in the touch handler so browser activation is retained.
      void player.play().catch(() => { if (active) failed(); });
    },
    stop,
  };
}
