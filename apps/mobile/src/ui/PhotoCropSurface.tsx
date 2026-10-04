/** @file Adapts native pan and pinch responders to shared photo crop geometry. */

import { useMemo, useRef } from 'react';
import { View, type GestureResponderEvent } from 'react-native';
import { PhotoGesture, panPhoto, zoomPhoto, type PhotoCrop } from '@little-say/core';
import { PhotoImage, type PhotoSource } from './PhotoImage';

export type PhotoCropSurfaceProps = { source: PhotoSource; size: number; crop: PhotoCrop; onChange: (crop: PhotoCrop) => void };
/** Render the square crop surface and translate native touch positions into bounded crop updates. */
export function PhotoCropSurface({ source, size, crop, onChange }: PhotoCropSurfaceProps) {
  const frame = { width: size, height: size };
  const gesture = useMemo(() => new PhotoGesture(source, { width: size, height: size }), [source, size]);
  const origin = useRef({ x: 0, y: 0 });
  const current = useRef(crop); current.current = crop;
  const move = (event: GestureResponderEvent) => {
    const points = event.nativeEvent.touches.map(t => ({ x: t.pageX - origin.current.x, y: t.pageY - origin.current.y }));
    current.current = gesture.move(current.current, points); onChange(current.current);
  };
  return <View accessible accessibilityRole="image" accessibilityLabel="Photo crop" accessibilityHint="Drag to move the photo. Pinch to zoom, or use the zoom slider. Positioning actions are also available."
    accessibilityActions={[{ name: 'left', label: 'Move photo left' }, { name: 'right', label: 'Move photo right' }, { name: 'up', label: 'Move photo up' }, { name: 'down', label: 'Move photo down' }, { name: 'increment', label: 'Zoom in' }, { name: 'decrement', label: 'Zoom out' }]}
    onAccessibilityAction={event => { const action = event.nativeEvent.actionName; gesture.reset(); onChange(action === 'increment' || action === 'decrement' ? zoomPhoto(source, frame, crop, crop.zoom + (action === 'increment' ? 0.05 : -0.05)) : panPhoto(source, frame, crop, action === 'left' ? -4 : action === 'right' ? 4 : 0, action === 'up' ? -4 : action === 'down' ? 4 : 0)); }}
    onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
    onResponderGrant={event => { origin.current = { x: event.nativeEvent.pageX - event.nativeEvent.locationX, y: event.nativeEvent.pageY - event.nativeEvent.locationY }; gesture.reset(); move(event); }}
    onResponderStart={move} onResponderMove={move} onResponderEnd={move}
    onResponderRelease={() => gesture.reset()} onResponderTerminate={() => gesture.reset()} onResponderTerminationRequest={() => false}
    style={{ width: size, height: size, overflow: 'hidden', borderRadius: 8 }}>
    <View pointerEvents="none" style={{ flex: 1 }}><PhotoImage source={source} frame={frame} crop={crop} /></View>
  </View>;
}
