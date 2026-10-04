import React from 'react';
import { Text, View } from 'react-native';
import { LockKeyhole } from 'lucide-react-native';
import { useParentHold } from './useParentHold';
import { theme } from './theme';
export interface ParentControlProps { cancelToken: number; onExitRequest: () => void; }
export function ParentControl({ cancelToken, onExitRequest }: ParentControlProps) {
  const hold = useParentHold(cancelToken);
  return <View testID="parent-control" accessible accessibilityRole="button" accessibilityLabel="Hold to unlock. Hold for two seconds and release." onAccessibilityTap={onExitRequest} accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'activate') onExitRequest(); }}
    onTouchStart={event => { const t = event.nativeEvent; hold.down(t.identifier, { x: t.pageX, y: t.pageY }, t.touches.length); }}
    onTouchMove={event => { const t = event.nativeEvent; hold.move(t.identifier, { x: t.pageX, y: t.pageY }); }}
    onTouchEnd={event => { if (hold.up(event.nativeEvent.identifier)) onExitRequest(); }} onTouchCancel={event => hold.cancelContact(event.nativeEvent.identifier)}
    style={{ minWidth: 116, minHeight: 48, borderRadius: 15, backgroundColor: hold.state !== 'idle' ? theme.accentPressed : theme.accentSoft, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 14 }}><LockKeyhole size={16} color={theme.accent} /><Text style={{ color: theme.accent, fontSize: 14, fontWeight: '700' }}>{hold.label}</Text></View>;
}
