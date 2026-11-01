/** @file Shares accessible account groups, navigation rows, provider labels, and action feedback. */
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { Provider } from '../../services/firebaseAccount';
import type { AccountController } from '../../services/useAccount';
import { Notice } from '../components';
import { styles, theme } from '../theme';

export const providerNames: Record<Provider, string> = { password: 'Email & password', 'google.com': 'Google', 'apple.com': 'Apple' };

/** Filter server provider identifiers to supported sign-in methods without inventing a fallback credential. */
export function linkedProviders(account: AccountController): Provider[] {
  return (account.session?.account.providers ?? []).filter((provider): provider is Provider => Object.hasOwn(providerNames, provider));
}

/** Group related account information under an optional short heading. */
export function AccountGroup({ title, children }: { title?: string; children: ReactNode }) {
  return <View style={{ gap: 10 }}>{title && <Text accessibilityRole="header" style={{ color: theme.muted, fontSize: 13, fontWeight: '700', paddingLeft: 4 }}>{title}</Text>}<View style={{ backgroundColor: theme.surface, borderRadius: 20, overflow: 'hidden' }}>{children}</View></View>;
}

/** Show a readable information row, or a touch-sized destination when onPress is supplied; text wraps at phone widths. */
export function AccountRow({ label, summary, icon: Icon, onPress, disabled, last = false }: {
  label: string; summary?: string; icon: LucideIcon; onPress?: () => void; disabled?: boolean; last?: boolean;
}) {
  const content = <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 18, minHeight: 76, borderBottomWidth: last ? 0 : 1, borderColor: theme.line }}>
    <Icon size={21} color={theme.muted} strokeWidth={1.7} accessible={false} />
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={{ color: theme.ink, fontSize: 15, fontWeight: '700' }}>{label}</Text>{summary && <Text style={styles.small}>{summary}</Text>}</View>
    {onPress && <ChevronRight size={17} color={theme.muted} accessible={false} />}
  </View>;
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={summary} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ paddingHorizontal: 18, opacity: disabled ? 0.5 : 1, backgroundColor: pressed ? theme.accentSoft : theme.surface })}>{content}</Pressable> : <View style={{ paddingHorizontal: 18 }}>{content}</View>;
}

/** Announce authentication feedback only on the account action page that owns it; sync has separate status. */
export function AccountFeedback({ account }: { account: AccountController }) {
  return <>{Boolean(account.error) && <Notice>{account.error}</Notice>}{Boolean(account.message) && <Text accessibilityLiveRegion="polite" style={styles.body}>{account.message}</Text>}</>;
}
