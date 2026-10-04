import React, { useEffect, useRef } from 'react';
import { BoardTouchController } from '@little-say/core';
import type { TouchSurfaceProps } from './TouchSurface';
import { TileFace } from './TileFace';
export function TouchSurface({ tiles, rects, playingId, tappedId, pendingId, onActivate, onContact }: TouchSurfaceProps) {
  const root = useRef<HTMLDivElement>(null);
  const values = useRef({ rects, onActivate, onContact }); values.current = { rects, onActivate, onContact };
  const controller = useRef(new BoardTouchController(id => values.current.onActivate(id), () => values.current.rects)).current;
  useEffect(() => { controller.cancel(); }, [rects, controller]);
  const point = (event: React.PointerEvent) => { const bounds = root.current!.getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; };
  return <div ref={root} data-testid="touch-surface" style={{ flex: 1, position: 'relative', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', overscrollBehavior: 'none' }}
    onContextMenu={event => event.preventDefault()} onDragStart={event => event.preventDefault()}
    onPointerDown={event => { if (event.pointerType === 'mouse' && event.button !== 0) return; values.current.onContact(); root.current?.setPointerCapture(event.pointerId); controller.down(event.pointerId, point(event)); }}
    onPointerUp={event => { controller.up(event.pointerId, point(event)); if (root.current?.hasPointerCapture(event.pointerId)) root.current.releasePointerCapture(event.pointerId); }}
    onPointerCancel={event => controller.cancel(event.pointerId)} onLostPointerCapture={event => controller.cancel(event.pointerId)}>
    {tiles.map((tile, index) => { const rect = rects[index]; return rect && <button key={tile.id} type="button" aria-label={tile.label} lang={tile.language} onClick={event => { if (event.detail === 0) onActivate(tile.id); }} style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, padding: 0, border: 0, borderRadius: 22, background: 'transparent', cursor: 'pointer', display: 'flex', touchAction: 'none' }}><TileFace tile={tile} playing={playingId === tile.id} tapped={tappedId === tile.id} pending={pendingId === tile.id} size={Math.min(110, Math.max(30, Math.min(rect.width, rect.height) * 0.45))} /></button>; })}
  </div>;
}
