/** @file Provides consistent responsive branding and navigation chrome for parent-facing app pages. */

import type { ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Brand } from './Brand';
import { styles, theme } from './theme';

/**
 * Keep the app identity and navigation aligned across native and web pages. Phones use a smaller
 * mark and masthead; optional page tools sit below it without crowding the brand or touch targets.
 * The containing screen owns safe-area insets; full-screen play uses its own header.
 */
export function AppHeader({ actions, children }: { actions: ReactNode; children?: ReactNode }) {
  const { width } = useWindowDimensions();
  const compact = width < 600;
  return <View testID="app-header" style={{ flexShrink: 0, backgroundColor: theme.surface, borderBottomWidth: 1, borderColor: theme.line }}>
    <View testID="app-header-bar" style={[styles.container, styles.row, { minHeight: compact ? 64 : 76, justifyContent: 'space-between', gap: 12 }]}>
      <Brand compact={compact} />
      <View style={[styles.row, { flexShrink: 0 }]}>{actions}</View>
    </View>
    {children && <View style={[styles.container, { paddingBottom: 12 }]}>{children}</View>}
  </View>;
}
