/** @file Shares a cancellable one-second automatic unlock and visible progress across all input methods. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { ParentExitGesture, PARENT_HOLD_MS, type ParentHoldState, type Point } from '@little-say/core';

/** Unlock once at the monotonic threshold without waiting for release; cancel early releases and interruptions. */
export function useParentHold(cancelToken: number, onUnlock: () => void) {
  const gesture = useRef(new ParentExitGesture()).current;
  const contacts = useRef(new Set<number | string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const accessibleAttempt = useRef(false);
  const unlock = useRef(onUnlock); unlock.current = onUnlock;
  const [state, setState] = useState<ParentHoldState>('idle');
  const [accessible, setAccessible] = useState(false);
  const [progress, setProgress] = useState(0);
  const clearTimer = useCallback(() => { generation.current++; clearTimeout(timer.current); timer.current = undefined; }, []);
  /** Cancel the current attempt and any pending assistive activation. */
  const cancel = useCallback(() => { clearTimer(); gesture.cancel(); if (accessibleAttempt.current) contacts.current.delete('accessibility'); accessibleAttempt.current = false; setAccessible(false); setState('idle'); setProgress(0); }, [clearTimer, gesture]);
  /** Forget all contacts and cancel the attempt after navigation or an interruption. */
  const reset = useCallback(() => { contacts.current.clear(); cancel(); }, [cancel]);
  useEffect(() => { reset(); return () => { clearTimer(); gesture.cancel(); }; }, [cancelToken, clearTimer, gesture, reset]);
  useEffect(() => {
    const app = AppState.addEventListener('change', state => { if (state !== 'active') reset(); });
    const blur = () => reset();
    const hidden = () => { if (document.hidden) reset(); };
    if (Platform.OS === 'web') { window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden); }
    return () => { app.remove(); if (Platform.OS === 'web') { window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden); } };
  }, [reset]);
  const down = (id: number | string, point: Point, touchCount?: number) => {
    if (accessibleAttempt.current) reset();
    if (touchCount === 1) contacts.current.clear();
    if (contacts.current.has(id)) return;
    contacts.current.add(id); cancel();
    if (contacts.current.size !== 1 || (touchCount !== undefined && touchCount !== 1)) return;
    gesture.down(id, point, performance.now()); setState(gesture.state);
    const attempt = generation.current;
    const update = () => {
      if (attempt !== generation.current) return;
      const now = performance.now();
      setState(gesture.advance(now));
      setProgress(1 - gesture.remaining(now) / PARENT_HOLD_MS);
      if (gesture.state === 'ready') {
        const valid = gesture.up(id, now); cancel();
        if (valid) unlock.current();
        return;
      }
      // Sample progress without allowing early timers or wall-clock changes to shorten the hold.
      if (gesture.state === 'holding') timer.current = setTimeout(update, Math.max(1, Math.min(16, gesture.remaining(now))));
    };
    timer.current = setTimeout(update, Math.min(16, gesture.remaining(performance.now())));
  };
  const move = (id: number | string, point: Point) => { gesture.move(id, point); if (gesture.state === 'idle') cancel(); };
  const up = (id: number | string) => {
    // A delayed timer must not reject a contact that has already met the same monotonic threshold.
    const valid = contacts.current.size === 1 && gesture.up(id, performance.now());
    contacts.current.delete(id); cancel();
    if (valid) unlock.current();
  };
  const cancelContact = (id: number | string) => { contacts.current.delete(id); cancel(); };
  // Assistive activation has no reliable press duration. It starts the same timed gate,
  // with announced cancellation, rather than bypassing it or requiring another confirmation.
  const activateAccessible = () => {
    if (gesture.state !== 'idle') { reset(); return; }
    reset(); down('accessibility', { x: 0, y: 0 });
    accessibleAttempt.current = true; setAccessible(true);
  };
  return { state, accessible, progress, label: accessible ? 'Unlocking. Activate to cancel.' : state === 'holding' ? 'Unlocking…' : 'Locked · hold 1 s to unlock', down, move, up, cancel, reset, cancelContact, activateAccessible };
}
