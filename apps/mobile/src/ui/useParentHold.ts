import { useEffect, useRef, useState } from 'react';
import { ParentExitGesture, type ParentHoldState, type Point } from '@little-say/core';

/** The label and release check share one gesture and one monotonic clock. */
export function useParentHold(cancelToken: number) {
  const gesture = useRef(new ParentExitGesture()).current;
  const contacts = useRef(new Set<number | string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const [state, setState] = useState<ParentHoldState>('idle');
  const clearTimer = () => { generation.current++; clearTimeout(timer.current); timer.current = undefined; };
  const cancel = () => { clearTimer(); gesture.cancel(); setState('idle'); };
  useEffect(() => {
    cancel();
    return () => { clearTimer(); gesture.cancel(); };
  }, [cancelToken]);
  const down = (id: number | string, point: Point, touchCount?: number) => {
    // Native reports all current touches, including after backgrounding. Web
    // keeps tracking captured pointers until their release/cancellation.
    if (touchCount === 1) contacts.current.clear();
    if (contacts.current.has(id)) return;
    contacts.current.add(id);
    cancel();
    if (contacts.current.size !== 1 || (touchCount !== undefined && touchCount !== 1)) return;
    gesture.down(id, point, performance.now()); setState(gesture.state);
    const attempt = generation.current;
    const update = () => {
      if (attempt !== generation.current) return;
      const now = performance.now();
      setState(gesture.advance(now));
      // A timer can run slightly early. Only the gesture can declare readiness.
      if (gesture.state === 'holding') timer.current = setTimeout(update, Math.max(1, gesture.remaining(now)));
    };
    timer.current = setTimeout(update, gesture.remaining(performance.now()));
  };
  const move = (id: number | string, point: Point) => {
    gesture.move(id, point);
    if (gesture.state === 'idle') cancel();
  };
  const up = (id: number | string) => {
    const valid = contacts.current.size === 1 && gesture.up(id, performance.now());
    contacts.current.delete(id); cancel(); return valid;
  };
  const cancelContact = (id: number | string) => { contacts.current.delete(id); cancel(); };
  return { state, label: state === 'ready' ? 'Release to continue' : state === 'holding' ? 'Keep holding…' : 'Hold to unlock', down, move, up, cancel, cancelContact };
}
