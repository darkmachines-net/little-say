import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, View, type GestureResponderEvent } from 'react-native';
import { BoardTouchController, type Tile, type TileRect } from '@little-say/core';
import { TileFace } from './TileFace';

export interface TouchSurfaceProps { tiles: Tile[]; rects: TileRect[]; playingId: string | null; tappedId: string | null; pendingId: string | null; onActivate: (id: string) => void; onContact: () => void; }
export function TouchSurface({ tiles, rects, playingId, tappedId, pendingId, onActivate, onContact }: TouchSurfaceProps) {
  const root = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const values = useRef({ rects, onActivate, onContact }); values.current = { rects, onActivate, onContact };
  const controller = useRef(new BoardTouchController(id => values.current.onActivate(id), () => values.current.rects)).current;
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => { void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader); const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader); return () => sub.remove(); }, []);
  useEffect(() => { controller.cancel(); root.current?.measureInWindow((x, y) => { origin.current = { x, y }; }); }, [rects, controller]);
  const handle = (event: GestureResponderEvent, phase: 'down' | 'up') => {
    if (screenReader) return;
    if (phase === 'down') values.current.onContact();
    const touches = event.nativeEvent.changedTouches ?? [event.nativeEvent];
    for (const touch of touches) controller[phase](touch.identifier, { x: touch.pageX - origin.current.x, y: touch.pageY - origin.current.y });
  };
  return <View ref={root} collapsable={false} onLayout={() => root.current?.measureInWindow((x, y) => { origin.current = { x, y }; })} onTouchStart={event => handle(event, 'down')} onTouchEnd={event => handle(event, 'up')} onTouchCancel={() => controller.cancel()} style={{ flex: 1 }}>
    {tiles.map((tile, index) => { const rect = rects[index]; return rect && <View key={tile.id} accessible accessibilityRole="button" accessibilityLabel={tile.label} accessibilityLanguage={tile.language} accessibilityHint="Plays this word" onAccessibilityTap={() => onActivate(tile.id)} onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'activate') onActivate(tile.id); }} accessibilityActions={[{ name: 'activate' }]} style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height }}><TileFace tile={tile} playing={playingId === tile.id} tapped={tappedId === tile.id} pending={pendingId === tile.id} size={Math.min(110, Math.max(30, Math.min(rect.width, rect.height) * 0.45))} /></View>; })}
  </View>;
}
