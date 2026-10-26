/** @file Keeps a fixed browser lock button mounted and separates fresh lock clicks from completing holds. */

import { useEffect, useRef } from 'react';
import { LockKeyhole, LockKeyholeOpen } from 'lucide-react-native';
import { theme } from './theme';
import type { ParentControlProps } from './ParentControl';

/** Route pointer, keyboard, and assistive holds to automatic unlock without relocking on release. */
export function ParentControl({ locked, hold, onLock }: ParentControlProps) {
  const button = useRef<HTMLButtonElement>(null);
  const key = useRef<string | null>(null);
  const pointerHeldLocked = useRef(false);
  const current = useRef(hold); current.current = hold;
  useEffect(() => {
    const otherContact = (event: PointerEvent) => { if (!button.current?.contains(event.target as Node)) current.current.reset(); };
    document.addEventListener('pointerdown', otherContact, true);
    return () => document.removeEventListener('pointerdown', otherContact, true);
  }, []);
  const inside = (x: number, y: number) => { const bounds = button.current!.getBoundingClientRect(); return x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom; };
  const Icon = locked ? LockKeyhole : LockKeyholeOpen;
  return <button ref={button} type="button" data-testid={locked ? 'parent-control' : 'board-lock'} aria-label={!locked ? 'Lock board' : hold.accessible ? 'Unlocking board. Activate again to cancel.' : 'Hold to unlock. Hold pointer, Space or Enter for one second. Assistive activation starts a one-second unlock; activate again to cancel.'} style={{ width: 48, height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 15, background: hold.state !== 'idle' ? theme.accentPressed : theme.accentSoft, color: theme.accent, padding: 0, touchAction: 'none', userSelect: 'none', cursor: 'pointer' }}
    onContextMenu={event => event.preventDefault()}
    onPointerDown={event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointerHeldLocked.current = locked;
      if (locked) { event.currentTarget.setPointerCapture(event.pointerId); hold.down(event.pointerId, { x: event.clientX, y: event.clientY }); }
    }}
    onPointerMove={event => { if (!inside(event.clientX, event.clientY)) hold.cancel(); else hold.move(event.pointerId, { x: event.clientX, y: event.clientY }); }}
    onPointerUp={event => { if (!inside(event.clientX, event.clientY)) hold.cancel(); hold.up(event.pointerId); }}
    onPointerCancel={event => hold.cancelContact(event.pointerId)} onLostPointerCapture={event => hold.cancelContact(event.pointerId)}
    onBlur={() => { key.current = null; hold.reset(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { key.current = null; hold.reset(); }
      if (event.key !== ' ' && event.key !== 'Enter') return;
      if (!locked && !key.current) return;
      event.preventDefault(); if (event.repeat || key.current) return;
      key.current = event.key; hold.down('key:' + event.key, { x: 0, y: 0 });
    }}
    onKeyUp={event => { if ((event.key !== ' ' && event.key !== 'Enter') || key.current !== event.key) return; event.preventDefault(); key.current = null; hold.up('key:' + event.key); }}
    onClick={event => {
      if (event.detail > 0 && pointerHeldLocked.current) { pointerHeldLocked.current = false; return; }
      if (key.current) return;
      if (!locked) onLock(); else if (event.detail === 0) hold.activateAccessible();
    }}><Icon size={24} color={theme.accent} /></button>;
}
