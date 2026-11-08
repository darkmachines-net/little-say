/** @file Renders accessible Google/Apple welcome actions with bundled provider artwork, leaving authentication to the account controller. */
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import type { SocialProvider } from '../../services/firebaseProviders';

/**
 * Show one branded sign-in action for both new and returning users. Assets and Google's medium font
 * load locally; disabled or busy actions cannot start another provider flow. Apple artwork preserves
 * its supplied proportions, while Google's live text grows with the device's accessibility setting.
 */
export function ProviderSignInButton({ provider, disabled, busy, onPress }: {
  provider: SocialProvider; disabled: boolean; busy: boolean; onPress: () => void;
}) {
  const [fontLoaded] = useFonts({ GoogleSansMedium: require('../../../assets/auth/google-sans-medium.ttf') });
  const apple = provider === 'apple.com';
  const label = `Sign in with ${apple ? 'Apple' : 'Google'}`;
  const blocked = disabled || busy;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: blocked, busy }}
    disabled={blocked} onPress={onPress} style={({ pressed }) => ({ minHeight: 50, borderRadius: 15,
      backgroundColor: apple ? '#000000' : '#FFFFFF', borderWidth: 1, borderColor: apple ? '#000000' : '#747775',
      justifyContent: 'center', alignItems: 'center', opacity: blocked ? 0.5 : pressed ? 0.75 : 1 })}>
    {busy ? <ActivityIndicator size="small" color={apple ? '#FFFFFF' : '#1F1F1F'} /> : apple
      ? <Image source={require('../../../assets/auth/apple-sign-in.png')} accessible={false} resizeMode="contain" style={{ width: 240, maxWidth: '100%', height: 50 }} />
      : <View pointerEvents="none" style={{ width: '100%', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 12 }}>
        <Image source={require('../../../assets/auth/google-g.png')} accessible={false} resizeMode="contain" style={{ width: 20, height: 20 }} />
        <Text style={{ flex: 1, textAlign: 'center', color: '#1F1F1F', fontSize: 14, lineHeight: 20, fontFamily: fontLoaded ? 'GoogleSansMedium' : undefined, fontWeight: fontLoaded ? undefined : '500' }}>{label}</Text>
        <View style={{ width: 20 }} />
      </View>}
  </Pressable>;
}
