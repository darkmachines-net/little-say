/** @file Animates an inert copy of the playing cards into the existing editor's measured preview. */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Platform, StyleSheet, View, useWindowDimensions, type ViewInstance } from 'react-native';
import type { Tile, TileRect } from '@little-say/core';
import { TileFace } from './TileFace';

export type BoardGeometry = { x: number; y: number; width: number; height: number; rects: TileRect[] };
export type BoardSnapshot = BoardGeometry & { tiles: Tile[]; viewport: { width: number; height: number } };

/** Keep the animation decorative: controls belong to the editor and every interruption settles there. */
export function BoardTransition({ source, target, onDone }: { source: BoardSnapshot; target: BoardGeometry | null; onDone: () => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  const root = useRef<ViewInstance>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [reduce, setReduce] = useState<boolean | null>(null);
  const { width, height } = useWindowDimensions();
  const done = useRef(onDone); done.current = onDone;
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduce(value); }).catch(() => { if (live) setReduce(true); });
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    const app = AppState.addEventListener('change', state => { if (state !== 'active') done.current(); });
    const interrupted = () => done.current();
    const hidden = () => { if (document.hidden) interrupted(); };
    if (Platform.OS === 'web') { window.addEventListener('blur', interrupted); document.addEventListener('visibilitychange', hidden); }
    // Missing measurements or a suspended frame must never leave an invisible preview indefinitely.
    const deadline = setTimeout(interrupted, 700);
    return () => { live = false; clearTimeout(deadline); motion.remove(); app.remove(); if (Platform.OS === 'web') { window.removeEventListener('blur', interrupted); document.removeEventListener('visibilitychange', hidden); } };
  }, []);
  useEffect(() => {
    if (reduce || width !== source.viewport.width || height !== source.viewport.height || !source.rects.length) { done.current(); return; }
    if (reduce === null || !origin || !target) return;
    const animation = Animated.timing(progress, { toValue: 1, duration: 260, useNativeDriver: true, isInteraction: false });
    animation.start(({ finished }) => { if (finished) done.current(); });
    return () => animation.stop();
  }, [reduce, width, height, source, origin, target, progress]);
  const interpolate = (from: number, to: number) => progress.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
  return <View ref={root} collapsable={false} onLayout={() => root.current?.measureInWindow((x, y) => setOrigin({ x, y }))} testID="board-transition" pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={StyleSheet.absoluteFill}>
    {origin && source.tiles.map((tile, index) => {
      const from = source.rects[index], to = target?.rects.find(rect => rect.id === tile.id);
      if (!from || from.width <= 0 || from.height <= 0) return null;
      const x = source.x + from.x - origin.x, y = source.y + from.y - origin.y;
      const endX = target && to ? target.x + to.x - origin.x : x, endY = target && to ? target.y + to.y - origin.y : y;
      return <Animated.View key={tile.id} style={{ position: 'absolute', left: x, top: y, width: from.width, height: from.height, opacity: progress.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }), transform: [{ translateX: interpolate(0, endX - x + ((to?.width ?? from.width) - from.width) / 2) }, { translateY: interpolate(0, endY - y + ((to?.height ?? from.height) - from.height) / 2) }, { scaleX: interpolate(1, (to?.width ?? from.width) / from.width) }, { scaleY: interpolate(1, (to?.height ?? from.height) / from.height) }] }}>
        <TileFace tile={tile} fitToFrame size={Math.min(110, Math.max(30, Math.min(from.width, from.height) * 0.45))} />
      </Animated.View>;
    })}
  </View>;
}
