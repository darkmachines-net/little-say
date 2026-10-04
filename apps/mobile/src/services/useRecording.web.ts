import { useCallback, useEffect, useRef, useState } from 'react';

type Session = {
  stream: MediaStream;
  recorder?: MediaRecorder;
  parts: Blob[];
  disposed: boolean;
  pending?: { promise: Promise<FormData>; resolve: (body: FormData) => void; reject: (error: Error) => void };
};
const cancelled = () => new Error('Recording cancelled.');
const failed = () => new Error('The recording failed. Please try again.');

export function useRecording(onError?: (message: string) => void) {
  const session = useRef<Session | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const report = useRef(onError); report.current = onError;
  const [recording, setRecording] = useState(false);

  const dispose = useCallback((value: Session, error?: Error) => {
    if (value.disposed) return;
    value.disposed = true;
    if (session.current === value) { session.current = null; if (mounted.current) setRecording(false); }
    const recorder = value.recorder;
    if (recorder) {
      recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* Tracks still need releasing if stopping fails. */ }
    }
    for (const track of value.stream.getTracks()) { try { track.stop(); } catch { /* Release every remaining track. */ } }
    value.parts = [];
    if (error) value.pending?.reject(error);
    value.pending = undefined;
  }, []);
  const cleanup = useCallback(async () => {
    generation.current++;
    if (session.current) dispose(session.current, cancelled());
  }, [dispose]);
  useEffect(() => {
    mounted.current = true;
    const visibility = () => { if (document.hidden) void cleanup(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', visibility); void cleanup(); };
  }, [cleanup]);

  const start = useCallback(async () => {
    const attempt = ++generation.current;
    if (session.current) dispose(session.current, cancelled());
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Voice prompts need a supported browser on HTTPS (or localhost). You can type your prompt instead.');
    let captured: MediaStream;
    try { captured = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { throw new Error('Microphone access was unavailable. Check browser permissions or type your prompt.'); }
    const value: Session = { stream: captured, parts: [], disposed: false };
    if (!mounted.current || attempt !== generation.current) { dispose(value, cancelled()); throw cancelled(); }
    session.current = value;
    const fail = (error: Error) => {
      if (value.disposed || session.current !== value) return;
      dispose(value, error);
      if (mounted.current) report.current?.(error.message);
    };
    try {
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(mime => MediaRecorder.isTypeSupported(mime));
      if (!mimeType) throw new Error('This browser cannot record a supported audio format. Please type your prompt.');
      const instance = new MediaRecorder(captured, { mimeType }); value.recorder = instance;
      instance.ondataavailable = event => { if (!value.disposed && session.current === value && event.data.size) value.parts.push(event.data); };
      instance.onerror = () => fail(failed());
      instance.onstop = () => {
        if (value.disposed || session.current !== value) return;
        const pending = value.pending;
        if (!pending) { fail(new Error('The recording stopped unexpectedly. Please try again.')); return; }
        try {
          const blob = new Blob(value.parts, { type: instance.mimeType });
          const form = new FormData(); form.append('audio', blob, instance.mimeType.includes('mp4') ? 'prompt.m4a' : 'prompt.webm');
          dispose(value); pending.resolve(form);
        } catch { fail(failed()); }
      };
      instance.start();
      if (value.disposed) throw failed();
      setRecording(true);
    } catch (error) {
      dispose(value, error instanceof Error ? error : failed());
      throw error;
    }
  }, [dispose]);

  const stop = useCallback((): Promise<FormData> => {
    const value = session.current;
    if (value?.pending) return value.pending.promise;
    const instance = value?.recorder;
    if (!value || !instance || instance.state !== 'recording') return Promise.reject(new Error('No active recording. Please record again.'));
    let resolve!: (body: FormData) => void, reject!: (error: Error) => void;
    const promise = new Promise<FormData>((yes, no) => { resolve = yes; reject = no; });
    value.pending = { promise, resolve, reject };
    try { instance.stop(); } catch { dispose(value, failed()); }
    return promise;
  }, [dispose]);
  return { recording, start, stop, cleanup };
}
