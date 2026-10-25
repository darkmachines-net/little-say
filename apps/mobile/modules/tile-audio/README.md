# Android tile audio

This local Expo module owns one ExoPlayer for foreground tile clips. It deliberately creates no MediaSession, notification, or playback service, so it does not advertise tile speech to Android or connected watch media controls. Expo autolinks it from the app's `modules` directory on Android only. Media3 stays aligned with the version used by `expo-audio`, which still handles microphone recording and iOS playback.

`audioPlayback.android.ts` subscribes before starting playback and serializes native commands. Each request has a unique ID: stale events and cancellation cannot affect the next clip. Readiness clears the three-second load timeout; completion, errors, cancellation, backgrounding, and module destruction release the player. Playback uses the media volume stream, speech audio attributes, ExoPlayer audio-focus management, and headphone-disconnection handling. The shared speech queue still owns its overall watchdog and cancels active/pending speech when the app backgrounds.

Missing native support (including Expo Go) and playback failures use system TTS through `hybridSpeech`; they never create an Expo audio player on Android. iOS and web retain their existing adapters.

This module changes the Android native fingerprint and requires a new binary/runtime through the normal release flow. An OTA update alone cannot install it. For development testing, use the [Development workflow](../../../../.github/workflows/development.yml) with operation build, platform android, and this branch's full commit SHA as source. Install the resulting Little Say Dev APK, then publish compatible previews from this branch using `npm run preview -- --platform android`. The [release integration](../../../../scripts/release/README.md#development-previews) owns development-client setup.

## Validation

Run `npm test -- apps/mobile/src/services/audioPlayback.android.test.ts apps/mobile/src/services/audioPlayback.test.ts apps/mobile/src/services/hybridSpeech.test.ts` for queue ordering, completion, failure fallback, timeout and cancellation races. Confirm Expo autolinking includes `LittleSayTileAudio` and compile the Android module after native dependency changes.

On a physical Android phone paired with a Galaxy Watch, play several generated clips, quickly select successive tiles, repeat a tile, and leave the app during playback. Confirm the latest queued tile plays after the current clip, backgrounding stops playback, missing audio uses TTS, and tile clips create no phone or watch media controls. Use `adb shell dumpsys media_session` to check for sessions owned by the app during playback. Emulator and unit checks do not establish connected-watch behavior.
