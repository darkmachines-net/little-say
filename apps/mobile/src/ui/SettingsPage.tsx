/** @file Supplies the responsive Settings shell, optional heading description and surface, and grouped navigation rows. */

import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Button } from './components';
import { useScreenFocus } from './screenFocus';
import { styles, theme } from './theme';

/** Render a routed page with Back and an accessible heading; keep its optional description directly below the title. */
export function SettingsPage({ title, description, backgroundColor = theme.background, backLabel, onBack, busy = false, status, children }: { title: string; description?: string; backgroundColor?: string; backLabel: string; onBack: () => void; busy?: boolean; status?: string; children: ReactNode }) {
  const heading = useScreenFocus();
  return <View style={[styles.page, { backgroundColor }]}>
    <View style={{ backgroundColor: theme.surface, borderBottomWidth: 1, borderColor: theme.line }}>
      <View style={[styles.container, styles.row, { maxWidth: 720, minHeight: 64, justifyContent: 'space-between' }]}>
        <Button compact kind="ghost" icon={ArrowLeft} disabled={busy} onPress={onBack}>{backLabel}</Button>
        <Text accessibilityLiveRegion="polite" style={styles.small}>{status || 'Little Say'}</Text>
      </View>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.container, { maxWidth: 680, paddingTop: 24, paddingBottom: 40, gap: 24 }]}>
      <View style={{ gap: 10 }}><View ref={heading} accessible tabIndex={-1} accessibilityRole="header" accessibilityLabel={title}><Text style={styles.heading}>{title}</Text></View>{description && <Text style={styles.body}>{description}</Text>}</View>
      {children}
    </ScrollView>
  </View>;
}

/** Keep related settings links together beneath one short label. */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <View style={{ gap: 10 }}><Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' }}>{title}</Text><View style={{ backgroundColor: theme.surface, borderRadius: 18, overflow: 'hidden' }}>{children}</View></View>;
}

/** Show one touch-sized destination with its current summary and a decorative chevron. */
export function SettingsRow({ label, summary, icon: Icon, onPress, last = false }: { label: string; summary?: string; icon?: LucideIcon; onPress: () => void; last?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={summary} onPress={onPress} style={({ pressed }) => ({ backgroundColor: pressed ? theme.accentSoft : theme.surface, paddingHorizontal: 16 })}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 17, minHeight: 78, borderBottomWidth: last ? 0 : 1, borderColor: theme.line }}>
      {Icon && <Icon size={22} color={theme.accent} strokeWidth={1.7} />}
      <View style={{ flex: 1, gap: 4 }}><Text style={{ color: theme.ink, fontSize: 16, fontWeight: '700' }}>{label}</Text>{summary && <Text style={styles.small}>{summary}</Text>}</View>
      <ChevronRight size={17} color={theme.muted} />
    </View>
  </Pressable>;
}
