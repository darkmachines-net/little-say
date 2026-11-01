/** @file Centers picture-work indicators in the artwork area, with replacement overlays and reduced-motion-aware activity. */
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Platform, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { type PictureTileState } from '../services/pictures';
import { theme } from './theme';
function ActivePicture() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let live = true;
    const animation = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 850, useNativeDriver: Platform.OS !== 'web', isInteraction: false }), Animated.timing(pulse, { toValue: 0, duration: 850, useNativeDriver: Platform.OS !== 'web', isInteraction: false })]));
    const motion = (reduce: boolean) => { if (!live) return; animation.stop(); pulse.setValue(0); if (!reduce) { animation.reset(); animation.start(); } };
    void AccessibilityInfo.isReduceMotionEnabled().then(motion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', motion);
    return () => { live = false; animation.stop(); subscription.remove(); };
  }, [pulse]);
  return <Animated.View testID="picture-active-animation" accessible={false} style={{ opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.1] }) }] }}><Sparkles size={14} color={theme.accent} /></Animated.View>;
}

/** Center pending work over its picture frame; replacements use a readable overlay and finished pictures stay unobstructed. */
export function PictureStatus({ state, replacing = false, compact = false }: { state: PictureTileState; replacing?: boolean; compact?: boolean }) {
  if (state === 'ready' || state === 'fallback') return null;
  const active = state === 'working' || state === 'finding' || state === 'generating' || state === 'loading';
  const label = replacing ? state === 'queued' ? 'Replacement queued' : 'Replacing picture' : state === 'finding' ? 'Finding a picture' : state === 'generating' ? 'Generating illustration' : state === 'loading' ? 'Loading picture' : active ? 'Improving picture' : 'Queued';
  return <View testID="picture-work-status" pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', padding: 4 }}>
    <View style={{ flexDirection: compact ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: compact ? 4 : 6, maxWidth: '100%', borderRadius: 10, padding: compact ? 3 : 8, backgroundColor: replacing ? 'rgba(255, 255, 255, 0.92)' : 'transparent' }}>
      {active && <ActivePicture />}<Text style={{ color: theme.ink, fontSize: 11, fontWeight: '600', textAlign: 'center', flexShrink: 1 }}>{label}</Text>
    </View>
  </View>;
}
