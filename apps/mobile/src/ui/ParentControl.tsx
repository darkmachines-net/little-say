/** @file Keeps a fixed native lock target mounted while routing taps, holds, and assistive activation. */

import { useRef } from 'react';
import { View, type ViewInstance } from 'react-native';
import { LockKeyhole, LockKeyholeOpen } from 'lucide-react-native';
import type { useParentHold } from './useParentHold';
import { theme } from './theme';

export interface ParentControlProps {
  locked: boolean;
  hold: ReturnType<typeof useParentHold>;
  /** Lock navigation after a fresh tap while unlocked. */
  onLock: () => void;
}

/** Unlock automatically after one second; only a contact begun unlocked may tap to lock. */
export function ParentControl({ locked, hold, onLock }: ParentControlProps) {
  const control = useRef<ViewInstance>(null);
  const lockContact = useRef<number | null>(null);
  const bounds = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const inside = (x: number, y: number) => { const b = bounds.current; return b.width > 0 && x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height; };
  const activate = () => { if (locked) hold.activateAccessible(); else onLock(); };
  const Icon = locked ? LockKeyhole : LockKeyholeOpen;
  return <View ref={control} collapsable={false} onLayout={() => control.current?.measureInWindow((x, y, width, height) => { bounds.current = { x, y, width, height }; })} testID={locked ? 'parent-control' : 'board-lock'} accessible accessibilityRole="button" accessibilityLiveRegion="polite" accessibilityLabel={!locked ? 'Lock board' : hold.accessible ? 'Unlocking board. Activate again to cancel.' : 'Hold to unlock. Hold for one second.'} accessibilityHint={locked ? 'With a screen reader, activate to start a one-second unlock. Activate again to cancel.' : 'Lock board navigation.'} onAccessibilityTap={activate} accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'activate') activate(); }}
    onTouchStart={event => {
      const t = event.nativeEvent;
      lockContact.current = !locked && t.touches.length === 1 ? t.identifier : null;
      if (locked) hold.down(t.identifier, { x: t.pageX, y: t.pageY }, t.touches.length);
    }}
    onTouchMove={event => { const t = event.nativeEvent; if (!inside(t.pageX, t.pageY)) { lockContact.current = null; hold.cancel(); } else hold.move(t.identifier, { x: t.pageX, y: t.pageY }); }}
    onTouchEnd={event => {
      const t = event.nativeEvent;
      if (!locked && lockContact.current === t.identifier && inside(t.pageX, t.pageY)) onLock();
      if (!inside(t.pageX, t.pageY)) hold.cancel();
      lockContact.current = null; hold.up(t.identifier);
    }}
    onTouchCancel={event => { lockContact.current = null; hold.cancelContact(event.nativeEvent.identifier); }}
    style={{ width: 48, height: 48, borderRadius: 15, backgroundColor: hold.state !== 'idle' ? theme.accentPressed : theme.accentSoft, justifyContent: 'center', alignItems: 'center' }}><Icon size={24} color={theme.accent} /></View>;
}
