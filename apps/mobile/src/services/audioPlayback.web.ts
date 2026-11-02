/** @file Plays decoded browser speech clips through a shared Web Audio output without restarting it per word. */

import { type SpeechDriver } from '@little-say/core';

// Keep one output for the page, including across editor/play queues. Reopening an HTML audio
// output for every short word can lose its onset while the desktop audio device starts up.
let context: AudioContext | undefined;
const startLeadSeconds = 0.05;

/**
 * Resume the shared browser output in the user gesture, then decode and play the entire clip.
 * Stop cancels loading/playback and releases per-clip resources; the page owns the reusable context.
 * Loading, decoding, or activation failures report once so hybrid speech can fall back to device TTS.
 */
export function audioPlayback(): SpeechDriver<string> {
  let cleanup: (() => void) | undefined;
  const stop = () => { const dispose = cleanup; cleanup = undefined; dispose?.(); };
  return {
    /** Play from sample zero only after decoding and output activation; ignore cancelled async work. */
    speak(uri, done, failed) {
      stop();
      let active = true;
      const request = new AbortController();
      let source: AudioBufferSourceNode | undefined;
      const finish = (callback: () => void) => {
        if (!active) return;
        stop(); callback();
      };
      const timeout = setTimeout(() => finish(failed), 3000);
      cleanup = () => {
        active = false; clearTimeout(timeout); request.abort();
        if (source) {
          source.onended = null;
          // A setup failure can leave a node that has not been started yet.
          try { source.stop(); } catch { /* Nothing is playing. */ }
          source.disconnect(); source.buffer = null;
        }
      };
      try {
        if (!context || context.state === 'closed') context = new AudioContext();
        const output = context;
        // Call resume before any await so browser autoplay policies retain the tap's activation.
        const ready = output.resume();
        const decoded = fetch(uri, { signal: request.signal }).then(response => {
          if (!response.ok) throw new Error('Speech clip could not be loaded.');
          return response.arrayBuffer();
        }).then(bytes => active ? output.decodeAudioData(bytes) : undefined);
        void Promise.all([ready, decoded]).then(([, buffer]) => {
          if (!active || !buffer) return;
          source = output.createBufferSource(); source.buffer = buffer;
          source.connect(output.destination);
          source.onended = () => finish(done);
          // A short scheduling lead lets the output render before the first speech sample.
          source.start(output.currentTime + startLeadSeconds, 0);
          clearTimeout(timeout);
        }).catch(() => finish(failed));
      } catch { finish(failed); }
    },
    /** Cancel this driver's work without closing the output shared by other speech queues. */
    stop,
  };
}
