/** @file Presents one labeled picture choice at a time with an expandable, explained vertical option list. */

import { useId, useRef, type KeyboardEvent } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Check, ChevronDown, ChevronUp } from 'lucide-react-native';
import { styles, theme } from './theme';

export interface PictureChoice<T extends string> { value: T; label: string; description: string; }

/**
 * Show the current choice and its explanation. Opening reveals one full-width list; selecting or
 * pressing Escape closes it and returns keyboard focus to the trigger. The parent owns which field is open.
 */
export function PictureChoiceField<T extends string>({ label, value, choices, expanded, onExpand, onChange, disabled = false }: { label: string; value: T; choices: readonly PictureChoice<T>[]; expanded: boolean; onExpand: (expanded: boolean) => void; onChange: (value: T) => void; disabled?: boolean }) {
  const trigger = useRef<View>(null);
  const helpId = useId();
  const selected = choices.find(choice => choice.value === value)!;
  const open = expanded && !disabled;
  const close = () => { onExpand(false); trigger.current?.focus(); };
  const Chevron = open ? ChevronUp : ChevronDown;
  return <View style={{ gap: 7 }} {...(Platform.OS === 'web' ? { onKeyDown: (event: KeyboardEvent) => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); } } } : {})}>
    <Text style={[styles.label, { marginBottom: 0 }]}>{label}</Text>
    <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={`${label}: ${selected.label}`} accessibilityHint={selected.description} accessibilityState={{ expanded: open, disabled }} aria-expanded={open} {...(Platform.OS === 'web' ? { 'aria-describedby': open ? undefined : helpId } : {})} disabled={disabled} onPress={() => onExpand(!open)} style={({ pressed }) => ({ minHeight: 52, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: open ? theme.accent : theme.line, backgroundColor: theme.surface, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 })}>
      <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: theme.ink }}>{selected.label}</Text><Chevron accessible={false} size={18} color={theme.muted} />
    </Pressable>
    {open ? <View style={{ borderWidth: 1, borderColor: theme.line, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.surface }}>
      {choices.map((choice, index) => <Pressable key={choice.value} accessibilityRole="button" accessibilityLabel={choice.label} accessibilityHint={choice.description} accessibilityState={{ selected: choice.value === value }} aria-pressed={choice.value === value} disabled={disabled} onPress={() => { onChange(choice.value); close(); }} style={({ pressed }) => ({ minHeight: 68, padding: 14, gap: 5, borderTopWidth: index ? 1 : 0, borderColor: theme.line, backgroundColor: pressed || choice.value === value ? theme.accentSoft : theme.surface })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: theme.ink }}>{choice.label}</Text>{choice.value === value && <Check accessible={false} size={18} color={theme.accent} />}</View>
        <Text style={styles.small}>{choice.description}</Text>
      </Pressable>)}
    </View> : <Text nativeID={helpId} style={styles.small}>{selected.description}</Text>}
  </View>;
}
