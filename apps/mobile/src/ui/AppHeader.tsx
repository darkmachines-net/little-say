/** @file Provides one responsive navigation row, tightening spacing on small phones to fit short route titles and full-size actions. */

import type { ReactNode } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { Brand } from './Brand';
import { Button } from './components';
import { useScreenFocus } from './screenFocus';
import { styles, theme } from './theme';

/**
 * Show home branding when title is omitted; subpages put Back and a focused route heading on the
 * left, with optional context below the title and page actions on the right in the same row.
 * Below 360 units, narrower padding and gaps keep compact titles readable without shrinking touch targets.
 * The containing screen owns safe-area insets; full-screen play uses its own controls.
 */
export function AppHeader({ title, subtitle, onBack, backLabel = 'Back', backDisabled = false, actions }: { title?: string; subtitle?: string; onBack?: () => void; backLabel?: string; backDisabled?: boolean; actions?: ReactNode }) {
  const { width } = useWindowDimensions();
  const compact = width < 600;
  const narrow = width < 360;
  const heading = useScreenFocus();
  return <View testID="app-header" style={{ flexShrink: 0, backgroundColor: theme.surface, borderBottomWidth: 1, borderColor: theme.line }}>
    <View testID="app-header-bar" style={[styles.container, styles.row, { minHeight: compact ? 64 : 76, justifyContent: 'space-between', gap: narrow ? 4 : 12 }, narrow && { paddingHorizontal: 8 }]}>
      {title ? <View style={[styles.row, { flex: 1, minWidth: 0, gap: narrow ? 4 : 8 }]}>
        {onBack && <Button kind="ghost" compact icon={ArrowLeft} disabled={backDisabled} onPress={onBack} accessibilityLabel={backLabel} />}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View ref={heading} accessible accessibilityRole="header" accessibilityLabel={title} tabIndex={-1}><Text numberOfLines={1} style={[styles.title, { fontSize: compact ? 20 : 22 }]}>{title}</Text></View>
          {subtitle && <Text numberOfLines={1} style={styles.small}>{subtitle}</Text>}
        </View>
      </View> : <Brand compact={compact} />}
      {actions && <View style={[styles.row, { flexShrink: 0, gap: narrow ? 0 : 6 }]}>{actions}</View>}
    </View>
  </View>;
}
