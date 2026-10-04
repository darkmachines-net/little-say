import { useCallback, useEffect, useRef, useState } from 'react';
export function useRecording() {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const parts = useRef<Blob[]>([]);
  const generation = useRef(0);
  const [recording, setRecording] = useState(false);
  const cleanup = useCallback(async () => {
    generation.current++;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    setRecording(false);
  }, []);
  useEffect(() => {
    const visibility = () => { if (document.hidden) void cleanup(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('visibilitychange', visibility); void cleanup(); };
  }, [cleanup]);
  const start = useCallback(async () => {
    const attempt = ++generation.current;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Voice prompts need a supported browser on HTTPS (or localhost). You can type your prompt instead.');
    try {
      const captured = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (attempt !== generation.current) { captured.getTracks().forEach(track => track.stop()); throw new Error('Recording cancelled.'); }
      stream.current = captured;
    }
    catch { throw new Error('Microphone access was unavailable. Check browser permissions or type your prompt.'); }
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(mime => MediaRecorder.isTypeSupported(mime));
    if (!mimeType) { await cleanup(); throw new Error('This browser cannot record a supported audio format. Please type your prompt.'); }
    parts.current = [];
    const instance = new MediaRecorder(stream.current, { mimeType }); recorder.current = instance;
    instance.ondataavailable = event => { if (event.data.size) parts.current.push(event.data); };
    instance.start(); setRecording(true);
  }, [cleanup]);
  const stop = useCallback((): Promise<FormData> => new Promise((resolve, reject) => {
    const instance = recorder.current;
    if (!instance || instance.state !== 'recording') { reject(new Error('No active recording. Please record again.')); return; }
    instance.onstop = () => {
      const blob = new Blob(parts.current, { type: instance.mimeType });
      const form = new FormData(); form.append('audio', blob, instance.mimeType.includes('mp4') ? 'prompt.m4a' : 'prompt.webm');
      stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
      parts.current = []; setRecording(false); resolve(form);
    };
    instance.onerror = () => { void cleanup(); reject(new Error('The recording failed. Please try again.')); };
    instance.stop();
  }), [cleanup]);
  return { recording, start, stop, cleanup };
}
