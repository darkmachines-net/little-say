import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { ImageOff, Volume2 } from 'lucide-react-native';
import { type Tile } from '@little-say/core';
import { PhotoImage, usePhotoSource } from './PhotoImage';
import { palettes, theme } from './theme';

export function Illustration({ tile, size = 64 }: { tile: Tile; size?: number }) {
  const [frame, setFrame] = useState({ width: size, height: size });
  const assetId = tile.illustration.kind === 'photo' ? tile.illustration.assetId : null;
  const loaded = usePhotoSource(assetId);
  const [failedId, setFailedId] = useState<string | null>(null);
  if (tile.illustration.kind === 'emoji') return <Text accessible={false} style={{ fontSize: size, lineHeight: size * 1.25, textAlign: 'center' }}>{tile.illustration.emoji}</Text>;
  const crop = tile.illustration;
  const side = Math.max(0, Math.min(frame.width, frame.height));
  return <View accessible={false} onLayout={event => setFrame(event.nativeEvent.layout)} style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
    <View testID="photo-frame" style={{ width: side, height: side, overflow: 'hidden', borderRadius: 8 }}>
      {loaded?.source && failedId !== assetId ? <PhotoImage source={loaded.source} frame={{ width: side, height: side }} crop={crop} onError={() => setFailedId(assetId)} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5 }}>{loaded?.error || failedId === assetId ? <><ImageOff size={Math.min(32, size)} color={theme.muted} /><Text style={{ color: theme.muted, fontSize: 11 }}>Photo unavailable</Text></> : <ActivityIndicator color={theme.muted} />}</View>}
    </View>
  </View>;
}
export function TileFace({ tile, compact = false, size = 64, playing = false, tapped = false, pending = false }: { tile: Tile; compact?: boolean; size?: number; playing?: boolean; tapped?: boolean; pending?: boolean }) {
  const palette = palettes[tile.color];
  return <View style={{ flex: 1, backgroundColor: palette.background, borderRadius: compact ? 14 : 24, overflow: 'hidden', borderWidth: 2, borderColor: pending ? theme.pending : 'transparent', padding: compact ? 5 : 12, justifyContent: 'center', alignItems: 'center', gap: compact ? 1 : 8 }}>
    <View style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: compact ? 6 : 12, minHeight: 0 }}><Illustration tile={tile} size={size} /></View>
    <Text accessible={false} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontSize: compact ? 12 : Math.max(17, Math.min(30, size * 0.4)), textAlign: 'center', fontWeight: '800', color: palette.ink, flexShrink: 0 }}>{tile.label}</Text>
    {playing && <View testID="tile-playing" pointerEvents="none" accessible={false} style={{ position: 'absolute', inset: 0, borderRadius: compact ? 8 : 20, borderWidth: 4, borderColor: theme.accent }}>
      <View style={{ position: 'absolute', top: 8, right: 8, padding: 5, borderRadius: 20, backgroundColor: theme.accent }}><Volume2 size={18} color="white" /></View>
    </View>}
    {tapped && <View testID="tile-tap" pointerEvents="none" accessible={false} style={{ position: 'absolute', inset: 7, borderRadius: compact ? 5 : 14, borderWidth: 3, borderColor: theme.clay, backgroundColor: 'rgba(255, 173, 63, 0.16)' }} />}
  </View>;
}
