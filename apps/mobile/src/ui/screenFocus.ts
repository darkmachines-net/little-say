/** @file Focuses new screen headings without opening the keyboard or stealing focus from an already-used control. */

import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform, findNodeHandle, type ViewInstance } from 'react-native';

/** Focus a new heading once; on web preserve any control focused before the scheduled frame runs. */
export function useScreenFocus() {
  const heading = useRef<ViewInstance>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (Platform.OS === 'web') {
        const active = document.activeElement;
        if (active && active !== document.body && active !== document.documentElement) return;
        (heading.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
      }
      else {
        const handle = findNodeHandle(heading.current);
        if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return heading;
}
