/** @file Renders the live board canvas with individual queued, animated active, completed, and fallback picture states. */

import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Platform, ScrollView, Text, View } from 'react-native';
import { Check, Clock, Sparkles } from 'lucide-react-native';
import { type Board } from '@little-say/core';
import { type PictureTileState } from '../services/pictures';
import { TileFace } from './TileFace';
import { theme, styles } from './theme';

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

/** Display a detached draft independently of chat scrolling; activity indicators stop or become static under reduced motion. */
export function DraftCanvas({ board, states, message, compact = false }: { board: Board | null; states: Record<string, PictureTileState>; message: string; compact?: boolean }) {
  return <View testID="ai-canvas" style={{ flex: 1, minHeight: 0, backgroundColor: theme.surface, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: theme.line }}>
    <View testID={board ? 'ai-draft' : undefined} style={{ flex: 1, minHeight: 0 }}>
    <View style={{ padding: compact ? 12 : 20, paddingBottom: 10, gap: 4 }}><Text style={styles.label}>Board draft</Text><Text accessibilityRole="header" style={styles.title}>{board?.title ?? 'Your board starts here'}</Text><Text accessibilityLiveRegion="polite" style={styles.small}>{message || (board ? `${board.tiles.length} ${board.tiles.length === 1 ? 'card' : 'cards'} · Keep adjusting until it feels right.` : 'Describe a board in the conversation. Its cards and pictures will appear here.')}</Text></View>
    <ScrollView testID="ai-canvas-scroll" style={{ flex: 1 }} contentContainerStyle={{ padding: compact ? 9 : 17, paddingTop: 0 }}>
      {board ? <View style={{ gap: 8 }}><View style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -4 }}>{board.tiles.map(tile => {
        const state = states[tile.id];
        const active = state === 'working' || state === 'finding' || state === 'generating';
        const label = state === 'finding' ? 'Finding a picture' : state === 'generating' ? 'Generating illustration' : active ? 'Improving picture' : state === 'queued' ? 'Queued' : state === 'ready' ? 'Ready' : state === 'fallback' ? tile.illustration.kind === 'emoji' ? 'Using emoji' : 'Kept picture' : '';
        return <View key={tile.id} testID={`draft-card-${tile.id}`} accessibilityLabel={`${tile.label}${label ? `: ${label}` : ''}`} style={{ width: '33.3333%', padding: 4 }}>
          <View style={{ height: compact ? 86 : 150, borderRadius: 16, borderWidth: active ? 2 : 0, borderColor: theme.accent }}><TileFace tile={tile} compact size={compact ? 40 : 72} /></View>
          {label && <View style={{ minHeight: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>{active ? <ActivePicture /> : state === 'queued' ? <Clock accessible={false} size={12} color={theme.muted} /> : state === 'ready' ? <Check accessible={false} size={12} color={theme.accent} /> : null}<Text style={{ color: theme.muted, fontSize: 11 }}>{label}</Text></View>}
        </View>;
      })}</View></View> : <View accessible={false} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 14 }}>{['#CCEFDF', '#FFDCC2', '#FFF0A9', '#CBEBFF', '#E2D8FF', '#FFD7E2'].map(color => <View key={color} style={{ width: '30%', height: compact ? 65 : 125, borderRadius: 16, backgroundColor: color, opacity: 0.45 }} />)}</View>}
    </ScrollView>
    </View>
  </View>;
}
