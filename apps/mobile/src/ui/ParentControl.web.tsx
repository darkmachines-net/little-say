/** @file Connects browser pointer, keyboard and assistive activation to the timed parent control. */

import { useEffect, useRef } from 'react';
import { useParentHold } from './useParentHold';
import { theme } from './theme';
import type { ParentControlProps } from './ParentControl';

/** Unlock on a two-second ready release, or a cancellable assistive countdown, never an ordinary click. */
export function ParentControl({ cancelToken, onExitRequest }: ParentControlProps) {
  const hold = useParentHold(cancelToken, onExitRequest);
  const button = useRef<HTMLButtonElement>(null);
  const key = useRef<string | null>(null);
  const current = useRef(hold); current.current = hold;
  useEffect(() => {
    const otherContact = (event: PointerEvent) => { if (!button.current?.contains(event.target as Node)) current.current.reset(); };
    document.addEventListener('pointerdown', otherContact, true);
    return () => document.removeEventListener('pointerdown', otherContact, true);
  }, []);
  const inside = (x: number, y: number) => { const bounds = button.current!.getBoundingClientRect(); return x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom; };
  return <button ref={button} type="button" data-testid="parent-control" aria-label={hold.accessible ? 'Unlocking editor. Activate again to cancel.' : 'Hold to unlock. Hold pointer, Space or Enter for two seconds and release. Assistive activation starts a two-second unlock; activate again to cancel.'} style={{ minWidth: 130, minHeight: 48, border: 0, borderRadius: 15, background: theme.accentSoft, color: theme.accent, fontFamily: 'system-ui, sans-serif', fontSize: 14, fontWeight: 700, padding: '10px 16px', touchAction: 'none', userSelect: 'none', cursor: 'pointer' }}
    onContextMenu={event => event.preventDefault()}
    onPointerDown={event => { if (event.pointerType === 'mouse' && event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); hold.down(event.pointerId, { x: event.clientX, y: event.clientY }); }}
    onPointerMove={event => { if (!inside(event.clientX, event.clientY)) hold.cancel(); else hold.move(event.pointerId, { x: event.clientX, y: event.clientY }); }}
    onPointerUp={event => { if (!inside(event.clientX, event.clientY)) hold.cancel(); if (hold.up(event.pointerId)) onExitRequest(); }}
    onPointerCancel={event => hold.cancelContact(event.pointerId)} onLostPointerCapture={event => hold.cancelContact(event.pointerId)}
    onBlur={() => { key.current = null; hold.reset(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { key.current = null; hold.reset(); }
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault(); if (event.repeat || key.current) return;
      key.current = event.key; hold.down(`key:${event.key}`, { x: 0, y: 0 });
    }}
    onKeyUp={event => { if (event.key !== ' ' && event.key !== 'Enter') return; event.preventDefault(); if (key.current !== event.key) return; key.current = null; if (hold.up(`key:${event.key}`)) onExitRequest(); }}
    onClick={event => { if (event.detail === 0 && !key.current) hold.activateAccessible(); }}><span aria-live="polite">{hold.label}</span></button>;
}
