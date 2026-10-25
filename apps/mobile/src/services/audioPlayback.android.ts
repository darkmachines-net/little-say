/** @file Adapts Android's session-free ExoPlayer module to cancellable tile speech playback. */

import { type SpeechDriver } from '@little-say/core';
import tileAudio from './tileAudio.android';

let nextRequest = 0;
let commands = Promise.resolve();

// Serialize ownership changes across drivers, including cancellation while a native call is pending.
function dispatch(command: () => Promise<void>) {
  const pending = commands.then(command);
  commands = pending.catch(() => {});
  return pending;
}

/**
 * Play Android clips without registering media controls. Stop invalidates callbacks immediately and
 * releases the native player. Missing native support, load timeouts, and decoder errors use the
 * caller's speech fallback; readiness cancels the three-second load timeout.
 */
export function audioPlayback(): SpeechDriver<string> {
  let cleanup: (() => void) | undefined;
  const stop = () => { const dispose = cleanup; cleanup = undefined; dispose?.(); };
  return {
    /** Replace this driver's clip and report completion or failure only while its request remains active. */
    speak(uri, done, failed) {
      stop();
      if (!tileAudio) { failed(); return; }
      const native = tileAudio;
      const id = String(++nextRequest);
      let active = true;
      const finish = (callback: () => void) => {
        if (!active) return;
        stop();
        callback();
      };
      const timeout = setTimeout(() => finish(failed), 3000);
      let subscription: ReturnType<typeof native.addListener> | undefined;
      cleanup = () => {
        active = false;
        clearTimeout(timeout);
        subscription?.remove();
        void dispatch(() => native.stop(id));
      };
      try {
        subscription = native.addListener('playbackStatus', status => {
          if (!active || status.id !== id) return;
          if (status.state === 'ready') clearTimeout(timeout);
          else finish(status.state === 'ended' ? done : failed);
        });
        void dispatch(async () => { if (active) await native.play(id, uri); }).catch(() => finish(failed));
      } catch {
        finish(failed);
      }
    },
    /** Release the owned clip and suppress callbacks from cancelled playback. */
    stop,
  };
}
