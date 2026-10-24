/** @file Shares one monotonic, cancellable two-second gate across pointer, keyboard and assistive input. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { ParentExitGesture, type ParentHoldState, type Point } from '@little-say/core';

/** Require a ready release for contacts, or a cancellable timed assistive activation; reset on interruption. */
export function useParentHold(cancelToken: number, onUnlock: () => void) {
  const gesture = useRef(new ParentExitGesture()).current;
  const contacts = useRef(new Set<number | string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const accessibleAttempt = useRef(false);
  const unlock = useRef(onUnlock); unlock.current = onUnlock;
  const [state, setState] = useState<ParentHoldState>('idle');
  const [accessible, setAccessible] = useState(false);
  const clearTimer = useCallback(() => { generation.current++; clearTimeout(timer.current); timer.current = undefined; }, []);
  /** Cancel the current attempt and any pending assistive activation. */
  const cancel = useCallback(() => { clearTimer(); gesture.cancel(); if (accessibleAttempt.current) contacts.current.delete('accessibility'); accessibleAttempt.current = false; setAccessible(false); setState('idle'); }, [clearTimer, gesture]);
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
      if (gesture.state === 'ready' && accessibleAttempt.current) {
        const valid = gesture.up('accessibility', now); reset();
        if (valid) unlock.current();
        return;
      }
      // A timer can run early; the same clock validates both feedback and release.
      if (gesture.state === 'holding') timer.current = setTimeout(update, Math.max(1, gesture.remaining(now)));
    };
    timer.current = setTimeout(update, gesture.remaining(performance.now()));
  };
  const move = (id: number | string, point: Point) => { gesture.move(id, point); if (gesture.state === 'idle') cancel(); };
  const up = (id: number | string) => {
    const valid = contacts.current.size === 1 && gesture.up(id, performance.now());
    contacts.current.delete(id); cancel(); return valid;
  };
  const cancelContact = (id: number | string) => { contacts.current.delete(id); cancel(); };
  // Assistive activation has no reliable press duration. It starts the same timed gate,
  // with announced cancellation, rather than bypassing it or requiring another confirmation.
  const activateAccessible = () => {
    if (gesture.state !== 'idle') { reset(); return; }
    reset(); down('accessibility', { x: 0, y: 0 });
    accessibleAttempt.current = true; setAccessible(true);
  };
  return { state, accessible, label: accessible ? 'Unlocking. Activate to cancel.' : state === 'ready' ? 'Release to edit' : state === 'holding' ? 'Keep holding…' : 'Hold to unlock', down, move, up, cancel, reset, cancelContact, activateAccessible };
}
