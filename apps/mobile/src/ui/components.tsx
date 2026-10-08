/** @file Defines shared parent-facing buttons, fields, notices, dialogs, and confirmations. */

import { useRef, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, useWindowDimensions } from 'react-native';
import { X, AlertCircle, type LucideIcon } from 'lucide-react-native';
import { theme, styles } from './theme';

/**
 * Render a touch-sized action with optional icon and busy feedback; busy or disabled actions cannot be
 * pressed.
 */
export function Button({ children, onPress, icon: Icon, kind = 'primary', disabled = false, busy = false, compact = false, accessibilityLabel, testID }: { children?: ReactNode; onPress: () => void; icon?: LucideIcon; kind?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; busy?: boolean; compact?: boolean; accessibilityLabel?: string; testID?: string }) {
  const color = kind === 'primary' ? 'white' : kind === 'danger' ? theme.red : theme.accent;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? (typeof children === 'string' ? children : undefined)} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [{ minHeight: 50, paddingHorizontal: compact ? 12 : 20, paddingVertical: 11, borderRadius: 15, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: kind === 'primary' ? theme.accent : kind === 'secondary' ? theme.accentSoft : kind === 'danger' ? '#FAEBE8' : 'transparent', borderWidth: kind === 'secondary' ? 1 : 0, borderColor: theme.accentSoft, opacity: disabled || busy ? 0.5 : pressed ? 0.75 : 1 }, compact && { minWidth: 44 }]}>
    {busy ? <ActivityIndicator size="small" color={color} /> : Icon ? <Icon size={18} color={color} strokeWidth={1.8} /> : null}
    {children ? <Text style={{ fontSize: 15, color, fontWeight: '700' }}>{children}</Text> : null}
  </Pressable>;
}
/**
 * Pair a visible label with an accessible text input while preserving caller-provided input props and
 * styles.
 */
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={{ gap: 0 }}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={theme.muted} {...props} style={[styles.field, props.style]} /></View>;
}
/** Present an accessible alert message with an optional recovery action. */
export function Notice({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <View accessibilityRole="alert" style={{ padding: 14, backgroundColor: '#FFF0E4', borderRadius: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}><AlertCircle size={19} color={theme.clay} /><View style={{ flex: 1, gap: 8 }}><Text style={{ color: '#855137', fontSize: 14, lineHeight: 21 }}>{children}</Text>{action}</View></View>;
}
/**
 * Dismiss on outside taps on native and web. Render before the dialog as a sibling so content taps
 * cannot trigger dismissal; the dialog's close button remains the keyboard and screen-reader action.
 * Require a press to start here so the opening gesture's trailing browser click cannot close it.
 */
export function ModalBackdrop({ onClose }: { onClose: () => void }) {
  const pressed = useRef(false);
  return <Pressable testID="modal-backdrop" accessible={false} tabIndex={-1} importantForAccessibility="no" onPressIn={() => { pressed.current = true; }} onPress={() => { if (pressed.current) { pressed.current = false; onClose(); } }} style={StyleSheet.absoluteFill} />;
}
/**
 * Present a responsive, scrollable modal with an optional fixed footer. Outside taps use the same
 * cancellation path as the close button and system back action, without confirming or saving.
 * Visibility can hide a parent sheet during full-screen navigation without resetting caller state.
 */
export function Sheet({ title, subtitle, onClose, children, footer, wide = false, visible = true }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; visible?: boolean }) {
  const { width, height } = useWindowDimensions();
  return <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose} statusBarTranslucent>
    <View style={{ display: visible ? 'flex' : 'none', flex: 1, backgroundColor: theme.scrim, justifyContent: 'center', alignItems: 'center', padding: width < 600 ? 12 : 30 }}>
      <ModalBackdrop onClose={onClose} />
      <View accessibilityViewIsModal style={{ backgroundColor: theme.background, borderRadius: 24, width: '100%', maxWidth: wide ? 860 : 580, maxHeight: height - 48, overflow: 'hidden', borderWidth: 1, borderColor: theme.line }}>
        <View style={{ padding: 24, paddingBottom: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}><View style={{ flex: 1, gap: 6 }}><Text accessibilityRole="header" style={styles.title}>{title}</Text>{Boolean(subtitle) && <Text style={styles.body}>{subtitle}</Text>}</View><Button icon={X} kind="ghost" compact onPress={onClose} accessibilityLabel={`Close ${title}`} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, gap: 20 }}>{children}</ScrollView>
        {footer && <View style={{ padding: 20, borderTopWidth: 1, borderColor: theme.line, backgroundColor: 'white', gap: 10 }}>{footer}</View>}
      </View>
    </View>
  </Modal>;
}
/**
 * Present an explicit confirmation action and a cancel path, optionally styling the action as
 * destructive.
 */
export function Confirm({ title, message, confirmLabel, onConfirm, onClose, danger = false }: { title: string; message: string; confirmLabel: string; onConfirm: () => void; onClose: () => void; danger?: boolean }) {
  return <Sheet title={title} onClose={onClose}><Text style={styles.body}>{message}</Text><View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap' }]}><Button kind="ghost" onPress={onClose}>Keep it</Button><Button kind={danger ? 'danger' : 'primary'} onPress={onConfirm}>{confirmLabel}</Button></View></Sheet>;
}
