/** @file Presents the illustrated account welcome with the mountain mascot, product promise, sign-up reassurance, and bottom-aligned authentication actions. */
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MountainMark } from '../Brand';
import { useScreenFocus } from '../screenFocus';
import { palettes, theme } from '../theme';

/** Warm canvas shared with the modal's safe-area edges. */
export const welcomeBackground = '#FFF9ED';

/**
 * Fill the safe viewport with decorative artwork and a focused heading, keeping account actions at
 * the bottom. The whole page can scroll on short screens or with large text, without clipping actions.
 * Artwork stays static and outside the accessibility tree; the heading and copy explain the product.
 */
export function AccountWelcome({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const heading = useScreenFocus();
  const artWidth = Math.max(160, Math.min(width - insets.left - insets.right - 48, (height - insets.top - insets.bottom) * 0.38, 350));
  return <ScrollView testID="account-welcome" style={welcomeStyles.page} contentContainerStyle={welcomeStyles.content} keyboardShouldPersistTaps="handled">
    <View style={welcomeStyles.hero}>
      <WelcomeArtwork width={artWidth} />
      <View ref={heading} accessible accessibilityRole="header" accessibilityLabel="Little Say: Learn to Talk!" tabIndex={-1} style={welcomeStyles.heading}>
        <Text style={welcomeStyles.brand}>Little Say</Text>
        <Text style={[welcomeStyles.title, width < 360 && { fontSize: 36, lineHeight: 42 }]}>Learn to Talk!</Text>
      </View>
      <Text style={welcomeStyles.description}>Make your own custom speaking soundboards for learning new words in seconds.</Text>
    </View>
    <View testID="account-welcome-actions" style={welcomeStyles.actions}>
      <Text style={welcomeStyles.invitation}>Free with no ads to support your child's learning.</Text>
      {children}
    </View>
  </ScrollView>;
}

function WelcomeArtwork({ width }: { width: number }) {
  const unit = width / 350;
  const cards = [
    { word: 'Water', picture: '💧', palette: palettes.sky, left: 30, top: 215, rotation: '-10deg' },
    { word: 'Love you', picture: '❤️', palette: palettes.rose, left: 133, top: 231, rotation: '3deg' },
    { word: 'Play', picture: '🧸', palette: palettes.butter, left: 236, top: 210, rotation: '12deg' },
  ];
  return <View testID="account-welcome-art" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width, height: 334 * unit, flexShrink: 0 }}>
    <View style={{ position: 'absolute', left: 29 * unit, top: 28 * unit, width: 292 * unit, height: 270 * unit, borderRadius: 146 * unit, backgroundColor: '#E4EED6' }} />
    <View style={{ position: 'absolute', right: 22 * unit, top: 8 * unit, width: 57 * unit, height: 57 * unit, borderRadius: 30 * unit, backgroundColor: '#FFE39A' }} />
    <Text allowFontScaling={false} style={{ position: 'absolute', left: 35 * unit, top: 7 * unit, color: theme.clay, fontSize: 31 * unit }}>✦</Text>
    <View style={{ position: 'absolute', left: 51 * unit, top: 19 * unit }}><MountainMark size={254 * unit} /></View>
    <View style={[welcomeStyles.bubble, { left: 0, top: 86 * unit, paddingHorizontal: 17 * unit, paddingVertical: 10 * unit, borderBottomRightRadius: 4, transform: [{ rotate: '-9deg' }] }]}>
      <Text allowFontScaling={false} style={{ color: theme.accent, fontSize: 19 * unit, fontWeight: '800' }}>hello!</Text>
    </View>
    <View style={[welcomeStyles.bubble, { right: 0, top: 122 * unit, paddingHorizontal: 14 * unit, paddingVertical: 10 * unit, borderBottomLeftRadius: 4, transform: [{ rotate: '8deg' }] }]}>
      <Text allowFontScaling={false} style={{ color: palettes.lilac.ink, fontSize: 17 * unit, fontWeight: '800' }}>let’s play!</Text>
    </View>
    {cards.map(card => <View key={card.word} style={[welcomeStyles.pictureCard, { left: card.left * unit, top: card.top * unit, width: 84 * unit, height: 94 * unit, borderRadius: 20 * unit, backgroundColor: card.palette.background, transform: [{ rotate: card.rotation }] }]}>
      <Text allowFontScaling={false} style={{ fontSize: 36 * unit, lineHeight: 45 * unit }}>{card.picture}</Text>
      <Text allowFontScaling={false} style={{ color: card.palette.ink, fontSize: 13 * unit, fontWeight: '800' }}>{card.word}</Text>
    </View>)}
    <View style={{ position: 'absolute', left: 7 * unit, top: 188 * unit, width: 9 * unit, height: 9 * unit, borderRadius: 5, backgroundColor: '#E9AC94' }} />
    <Text allowFontScaling={false} style={{ position: 'absolute', right: 1 * unit, top: 185 * unit, color: theme.accent, fontSize: 25 * unit }}>✧</Text>
  </View>;
}

const welcomeStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: welcomeBackground },
  content: { flexGrow: 1, width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 20, gap: 28 },
  hero: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: 18 },
  heading: { alignItems: 'center', gap: 5, outlineStyle: 'solid', outlineWidth: 0 },
  brand: { color: theme.ink, fontSize: 28, fontWeight: '800', letterSpacing: -0.8, textAlign: 'center' },
  title: { color: theme.accent, fontSize: 42, lineHeight: 49, fontWeight: '900', letterSpacing: -1.5, textAlign: 'center' },
  description: { color: theme.muted, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  actions: { gap: 12, flexShrink: 0 },
  invitation: { color: theme.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 2 },
  bubble: { position: 'absolute', backgroundColor: theme.surface, borderRadius: 23 },
  pictureCard: { position: 'absolute', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: theme.surface, gap: 2, boxShadow: '0 5px 0 rgba(32, 59, 53, 0.08)' },
});
