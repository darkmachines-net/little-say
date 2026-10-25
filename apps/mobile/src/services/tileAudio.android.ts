/** @file Defines the Android-only, session-free tile playback bridge and its request-scoped events. */

import { requireOptionalNativeModule } from 'expo';

export type TileAudioStatus = { id: string; state: 'ready' | 'ended' | 'error' };

export interface TileAudioModule {
  /** Replace the owned clip; resolve after preparing playback, not when the sound finishes. */
  play(id: string, uri: string): Promise<void>;
  /** Release only the matching clip. Repeated or stale cancellation is harmless. */
  stop(id: string): Promise<void>;
  /** Subscribe before play so even immediate load/decoder events retain their request identity. */
  addListener(event: 'playbackStatus', listener: (status: TileAudioStatus) => void): {
    /** Detach this subscription; events already delivered to JS may still run. */
    remove(): void;
  };
}

// Older binaries and Expo Go use system TTS through the existing failure path, never expo-audio.
export default requireOptionalNativeModule<TileAudioModule>('LittleSayTileAudio');
