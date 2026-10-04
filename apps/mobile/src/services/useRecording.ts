import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';

export function useRecording() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const mounted = useRef(false);
  const recordingUri = useRef<string | null>(null);
  const live = useRef(false);
  const generation = useRef(0);

  // Expo releases its recorder in a passive effect. Mark it unavailable first,
  // so neither our teardown nor a pending async operation touches that object.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, []);

  const cleanup = useCallback(async () => {
    generation.current++;
    const shouldStop = mounted.current && live.current;
    const uri = recordingUri.current;
    recordingUri.current = null;
    live.current = false;
    if (mounted.current) setRecording(false);
    if (shouldStop) {
      try { await recorder.stop(); } catch { /* The OS may already have stopped recording. */ }
    }
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    // Only use the saved path: even reading recorder.uri after release throws.
    if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }, [recorder]);

  const start = useCallback(async () => {
    const attempt = ++generation.current;
    const checkActive = () => {
      if (!mounted.current || attempt !== generation.current) throw new Error('Recording cancelled.');
    };
    try {
      checkActive();
      const permission = await requestRecordingPermissionsAsync();
      checkActive();
      if (!permission.granted) throw new Error('Microphone access was declined. You can type your prompt instead.');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      checkActive();
      recordingUri.current = recorder.uri;
      await recorder.prepareToRecordAsync();
      if (mounted.current) recordingUri.current = recorder.uri;
      checkActive();
      live.current = true;
      recorder.record();
      setRecording(true);
    } catch (error) {
      if (attempt === generation.current || !live.current) await cleanup();
      throw error;
    }
  }, [recorder, cleanup]);

  const stop = useCallback(async (): Promise<FormData> => {
    if (!mounted.current || !live.current) throw new Error('No active recording. Please record again.');
    const attempt = generation.current;
    live.current = false;
    try {
      await recorder.stop();
      if (!mounted.current || attempt !== generation.current) throw new Error('Recording cancelled.');
      recordingUri.current = recorder.uri;
    } finally {
      if (mounted.current) setRecording(false);
      await setAudioModeAsync({ allowsRecording: false });
    }
    if (!mounted.current || attempt !== generation.current) throw new Error('Recording cancelled.');
    if (!recordingUri.current) throw new Error('The recording was unavailable. Please try again.');
    const form = new FormData();
    // Expo fetch reads File.bytes(); the old React Native URI object is rejected.
    form.append('audio', new File(recordingUri.current));
    return form;
  }, [recorder]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'background' || (state !== 'active' && live.current)) void cleanup(); });
    return () => { subscription.remove(); void cleanup(); };
  }, [cleanup]);
  return { recording, start, stop, cleanup };
}
