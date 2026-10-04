/** @file Shares the Little Say mountain mark and wordmark across app screens. */

import { Image, Text, View } from 'react-native';
import { theme } from './theme';

// Decorative and never a touch target; the adjacent name/content supplies context.
/** Render the bundled mountain artwork at the requested logical size. */
export function MountainMark({ size = 56 }: { size?: number }) {
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: size, height: size, flexShrink: 0 }}><Image source={require('../../assets/brand/mountain.png')} accessible={false} resizeMode="contain" style={{ width: size, height: size }} /></View>;
}

/** Arrange the mountain mark and app name horizontally or vertically to suit the containing screen. */
export function Brand({ stacked = false }: { stacked?: boolean }) {
  return <View style={{ flexDirection: stacked ? 'column' : 'row', alignItems: 'center', gap: stacked ? 8 : 10, flexShrink: 1 }}>
    <MountainMark size={stacked ? 128 : 56} />
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: stacked ? 30 : 26, fontWeight: '800', letterSpacing: -0.9, color: theme.ink, flexShrink: 1 }}>Little Say</Text>
  </View>;
}
