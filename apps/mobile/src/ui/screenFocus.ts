/** @file Moves mode-change focus to a non-editable heading without opening the keyboard or playing a card. */

import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform, View, findNodeHandle } from 'react-native';

/** Focus the mounted screen heading once; cancel the scheduled focus when navigation changes again. */
export function useScreenFocus() {
  const heading = useRef<View>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (Platform.OS === 'web') (heading.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
      else {
        const handle = findNodeHandle(heading.current);
        if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return heading;
}
