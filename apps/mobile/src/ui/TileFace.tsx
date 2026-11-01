/** @file Shares tile visuals, centered picture-work placeholders, faded replacement overlays, and speech feedback. */

import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { ImageOff, Volume2 } from 'lucide-react-native';
import { type Tile } from '@little-say/core';
import { PhotoImage, usePhotoSource } from './PhotoImage';
import { PictureImage } from './PictureImage';
import { PictureStatus } from './PictureStatus';
import { type PictureTileState } from '../services/pictures';
import { palettes, theme } from './theme';

/** Render emoji, a full local illustration, or a cropped photo, with visible unresolved/missing states. */
export function Illustration({ tile, size = 64 }: { tile: Tile; size?: number }) {
  const [frame, setFrame] = useState({ width: size, height: size });
  const assetId = tile.illustration.kind === 'photo' ? tile.illustration.assetId : null;
  const loaded = usePhotoSource(assetId);
  const [failedId, setFailedId] = useState<string | null>(null);
  if (tile.illustration.kind === 'emoji') return <Text accessible={false} style={{ fontSize: size, lineHeight: size * 1.25, textAlign: 'center' }}>{tile.illustration.emoji}</Text>;
  if (tile.illustration.kind === 'library' || tile.illustration.kind === 'generated') return <PictureImage assetId={tile.illustration.assetId} />;
  if (tile.illustration.kind === 'unresolved') return <View accessible={false} style={{ alignItems: 'center', gap: 6 }}><ImageOff size={Math.min(size, 36)} color={theme.muted} /><Text style={{ color: theme.muted, fontSize: 12 }}>Needs a picture</Text></View>;
  const crop = tile.illustration;
  const side = Math.max(0, Math.min(frame.width, frame.height));
  return <View accessible={false} onLayout={event => setFrame(event.nativeEvent.layout)} style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
    <View testID="photo-frame" style={{ width: side, height: side, overflow: 'hidden', borderRadius: 8 }}>
      {loaded?.source && failedId !== assetId ? <PhotoImage source={loaded.source} frame={{ width: side, height: side }} crop={crop} onError={() => setFailedId(assetId)} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5 }}>{loaded?.error || failedId === assetId ? <><ImageOff size={Math.min(32, size)} color={theme.muted} /><Text style={{ color: theme.muted, fontSize: 11 }}>Photo unavailable</Text></> : <ActivityIndicator color={theme.muted} />}</View>}
    </View>
  </View>;
}
/**
 * Display the tile label and visual with separate playing, recently tapped, and pending speech
 * feedback. Opt-in frame fitting preserves pictures on dense play boards. picturePending reserves
 * the illustration space for new word-only previews without altering the tile's saved fallback.
 * Pending pictureState centers status in that space; existing artwork fades behind its replacement
 * overlay. Completion, fallback, or cancellation restores full opacity and removes the overlay.
 */
export function TileFace({ tile, compact = false, size = 64, playing = false, tapped = false, pending = false, fitToFrame = false, picturePending = false, pictureState }: { tile: Tile; fitToFrame?: boolean; compact?: boolean; size?: number; playing?: boolean; tapped?: boolean; pending?: boolean; picturePending?: boolean; pictureState?: PictureTileState }) {
  const palette = palettes[tile.color];
  const [height, setHeight] = useState(Infinity);
  const [picture, setPicture] = useState({ width: size, height: size * 1.25 });
  const dense = fitToFrame && !compact && height < 140;
  const updatingPicture = Boolean(pictureState && pictureState !== 'ready' && pictureState !== 'fallback');
  const missingPicture = picturePending || tile.illustration.kind === 'unresolved';
  // Reserve label space first, then fit emoji inside the actual remaining picture frame. Dense
  // boards need smaller gutters, not clipped pictures or smaller accessible touch targets.
  const pictureSize = fitToFrame ? Math.max(0, Math.min(size, picture.width, picture.height / 1.25)) : size;
  return <View onLayout={event => setHeight(event.nativeEvent.layout.height)} style={{ flex: 1, backgroundColor: palette.background, borderRadius: compact ? 14 : 24, overflow: 'hidden', borderWidth: 2, borderColor: pending ? theme.pending : 'transparent', padding: compact ? 5 : dense ? 4 : 12, justifyContent: 'center', alignItems: 'center', gap: compact ? 1 : dense ? 2 : 8 }}>
    <View testID="tile-picture" onLayout={event => setPicture(event.nativeEvent.layout)} style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: compact ? 6 : 12, minHeight: 0 }}>
      {!(updatingPicture && missingPicture) && <View testID="tile-picture-artwork" style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', opacity: updatingPicture ? 0.25 : 1 }}><Illustration tile={tile} size={pictureSize} /></View>}
      {updatingPicture && <PictureStatus state={pictureState!} replacing={!missingPicture} compact={picture.height < 70} />}
    </View>
    <Text accessible={false} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontSize: compact ? 12 : Math.max(17, Math.min(30, size * 0.4)), textAlign: 'center', fontWeight: '800', color: palette.ink, flexShrink: 0 }}>{tile.label}</Text>
    {playing && <View testID="tile-playing" pointerEvents="none" accessible={false} style={{ position: 'absolute', inset: 0, borderRadius: compact ? 8 : 20, borderWidth: 4, borderColor: theme.accent }}>
      <View style={{ position: 'absolute', top: 8, right: 8, padding: 5, borderRadius: 20, backgroundColor: theme.accent }}><Volume2 size={18} color="white" /></View>
    </View>}
    {tapped && <View testID="tile-tap" pointerEvents="none" accessible={false} style={{ position: 'absolute', inset: 7, borderRadius: compact ? 5 : 14, borderWidth: 3, borderColor: theme.clay, backgroundColor: 'rgba(255, 173, 63, 0.16)' }} />}
  </View>;
}
