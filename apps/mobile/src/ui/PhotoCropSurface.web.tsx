import React, { useMemo, useRef } from 'react';
import { PhotoGesture, panPhoto, zoomPhoto, type PhotoPoint } from '@little-say/core';
import type { PhotoCropSurfaceProps } from './PhotoCropSurface';
import { PhotoImage } from './PhotoImage';

export function PhotoCropSurface({ source, size, crop, onChange }: PhotoCropSurfaceProps) {
  const gesture = useMemo(() => new PhotoGesture(source, { width: size, height: size }), [source, size]);
  const points = useRef(new Map<number, PhotoPoint>());
  const current = useRef(crop); current.current = crop;
  const move = () => { current.current = gesture.move(current.current, [...points.current.values()]); onChange(current.current); };
  const point = (event: React.PointerEvent<HTMLDivElement>) => { const bounds = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; };
  const end = (event: React.PointerEvent<HTMLDivElement>) => { points.current.delete(event.pointerId); move(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  return <div role="group" aria-label="Photo crop" tabIndex={0} data-testid="photo-crop-surface" title="Drag to move. Pinch to zoom. Arrow keys move the photo; + and − zoom."
    style={{ width: size, height: size, overflow: 'hidden', position: 'relative', borderRadius: 8, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', cursor: 'grab', flexShrink: 0 }}
    onContextMenu={event => event.preventDefault()} onDragStart={event => event.preventDefault()}
    onPointerDown={event => { if (event.pointerType === 'mouse' && event.button !== 0) return; event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); points.current.set(event.pointerId, point(event)); move(); }}
    onPointerMove={event => { if (points.current.has(event.pointerId)) { points.current.set(event.pointerId, point(event)); move(); } }}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={event => { points.current.delete(event.pointerId); gesture.reset(); }}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'].includes(event.key)) return;
      event.preventDefault(); gesture.reset(); const frame = { width: size, height: size }; const step = event.shiftKey ? 12 : 2;
      onChange(['+', '=', '-'].includes(event.key) ? zoomPhoto(source, frame, crop, crop.zoom + (event.key === '-' ? -0.05 : 0.05)) : panPhoto(source, frame, crop, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
    }}>
    <div style={{ pointerEvents: 'none' }}><PhotoImage source={source} frame={{ width: size, height: size }} crop={crop} /></div>
  </div>;
}
