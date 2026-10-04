/** @file Adapts Expo audio players to the shared speech-driver contract. */

import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { type SpeechDriver } from '@little-say/core';

/**
 * Create a native clip driver with a load timeout and silent-mode playback. Stop releases the owned
 * player and suppresses late callbacks.
 */
export function audioPlayback(): SpeechDriver<string> {
  let cleanup: (() => void) | undefined;
  const stop = () => { const dispose = cleanup; cleanup = undefined; dispose?.(); };
  return {
    speak(uri, done, failed) {
      stop();
      const player = createAudioPlayer({ uri }, { updateInterval: 100 });
      let active = true;
      const timeout = setTimeout(() => { if (active) failed(); }, 3000);
      const subscription = player.addListener('playbackStatusUpdate', status => {
        if (!active) return;
        if (status.isLoaded) clearTimeout(timeout);
        if (status.playbackState === 'error') failed();
        else if (status.didJustFinish) done();
      });
      cleanup = () => {
        active = false; clearTimeout(timeout); subscription.remove();
        // This player is owned here, not by a releasing React hook.
        player.remove();
      };
      void setAudioModeAsync({ playsInSilentMode: true }).then(() => {
        if (active) player.play();
      }).catch(() => { if (active) failed(); });
    },
    stop,
  };
}
