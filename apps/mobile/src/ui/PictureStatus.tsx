/** @file Shows per-card picture work with reduced-motion-aware activity and concise status. */
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

/** Display activity only for running work; queued and finished cards remain static. */
export function PictureStatus({ state }: { state: PictureTileState }) {
  const active = state === 'working' || state === 'finding' || state === 'generating';
  const label = state === 'finding' ? 'Finding a picture' : state === 'generating' ? 'Generating illustration' : active ? 'Improving picture' : state === 'queued' ? 'Queued' : state === 'ready' ? 'Ready' : 'Kept picture';
  return <View style={{ position: 'absolute', bottom: 0, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.surface, borderRadius: 6, padding: 2 }}>{active && <ActivePicture />}<Text style={{ color: theme.muted, fontSize: 10 }}>{label}</Text></View>;
}
