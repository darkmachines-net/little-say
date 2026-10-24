/** @file Connects native contacts and assistive activation to the timed parent control. */

import { useRef } from 'react';
import { Text, View, type ViewInstance } from 'react-native';
import { LockKeyhole } from 'lucide-react-native';
import { useParentHold } from './useParentHold';
import { theme } from './theme';

export interface ParentControlProps { cancelToken: number; onExitRequest: () => void; }

/** Require a ready release inside the control, with a cancellable timed screen-reader alternative. */
export function ParentControl({ cancelToken, onExitRequest }: ParentControlProps) {
  const hold = useParentHold(cancelToken, onExitRequest);
  const control = useRef<ViewInstance>(null);
  const bounds = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const inside = (x: number, y: number) => { const b = bounds.current; return b.width > 0 && x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height; };
  return <View ref={control} collapsable={false} onLayout={() => control.current?.measureInWindow((x, y, width, height) => { bounds.current = { x, y, width, height }; })} testID="parent-control" accessible accessibilityRole="button" accessibilityLiveRegion="polite" accessibilityLabel={hold.accessible ? 'Unlocking editor. Activate again to cancel.' : 'Hold to unlock. Hold for two seconds and release.'} accessibilityHint="With a screen reader, activate to start a two-second unlock. Activate again to cancel." onAccessibilityTap={hold.activateAccessible} accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'activate') hold.activateAccessible(); }}
    onTouchStart={event => { const t = event.nativeEvent; hold.down(t.identifier, { x: t.pageX, y: t.pageY }, t.touches.length); }}
    onTouchMove={event => { const t = event.nativeEvent; if (!inside(t.pageX, t.pageY)) hold.cancel(); else hold.move(t.identifier, { x: t.pageX, y: t.pageY }); }}
    onTouchEnd={event => { const t = event.nativeEvent; if (!inside(t.pageX, t.pageY)) hold.cancel(); if (hold.up(t.identifier)) onExitRequest(); }} onTouchCancel={event => hold.cancelContact(event.nativeEvent.identifier)}
    style={{ minWidth: 116, minHeight: 48, borderRadius: 15, backgroundColor: hold.state !== 'idle' ? theme.accentPressed : theme.accentSoft, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 14 }}><LockKeyhole size={16} color={theme.accent} /><Text style={{ color: theme.accent, fontSize: 14, fontWeight: '700' }}>{hold.label}</Text></View>;
}
