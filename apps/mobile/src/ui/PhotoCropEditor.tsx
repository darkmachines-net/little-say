/**
 * @file Combines photo gestures, zoom controls, and a tile preview using the same crop geometry as
 * playback.
 */

import { useEffect } from 'react';
import { ActivityIndicator, Platform, Text, View, useWindowDimensions } from 'react-native';
import { RotateCcw } from 'lucide-react-native';
import { zoomPhoto, type Tile } from '@little-say/core';
import { type TilePhoto } from '../services/photos';
import { Button, Notice } from './components';
import { PhotoCropSurface } from './PhotoCropSurface';
import { usePhotoSource } from './PhotoImage';
import { PhotoZoom } from './PhotoZoom';
import { palettes, styles, theme } from './theme';

/**
 * Load the selected photo, report whether it is ready, and emit crop changes while previewing the
 * actual tile appearance.
 */
export function PhotoCropEditor({ tile, photo, onChange, onReady }: { tile: Tile; photo: TilePhoto; onChange: (photo: TilePhoto) => void; onReady: (ready: boolean) => void }) {
  const crop = photo;
  const { width, height } = useWindowDimensions();
  const loaded = usePhotoSource(photo.assetId);
  useEffect(() => { onReady(Boolean(loaded?.source)); }, [loaded, onReady]);
  const size = Math.floor(Math.max(140, Math.min(380, width - 104, height - 470)));
  const palette = palettes[tile.color];
  const zoom = (value: number) => { if (loaded?.source) onChange({ ...photo, ...zoomPhoto(loaded.source, { width: size, height: size }, photo, value) }); };
  return <View style={{ gap: 16 }}>
    <Text style={styles.body}>Drag to move. Pinch or use the slider to zoom.</Text>
    <View style={{ alignItems: 'center' }}><View style={{ padding: 14, gap: 10, borderRadius: 24, backgroundColor: palette.background, alignItems: 'center' }}>
      {loaded?.source ? <PhotoCropSurface source={loaded.source} size={size} crop={crop} onChange={value => onChange({ ...photo, ...value })} /> : <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>{loaded?.error ? <Notice>This photo could not be opened. Choose it again from your library.</Notice> : <ActivityIndicator color={theme.accent} />}</View>}
      <Text numberOfLines={2} style={{ fontSize: 24, fontWeight: '800', color: palette.ink, textAlign: 'center', maxWidth: size }}>{tile.label}</Text>
    </View></View>
    <View style={{ gap: 4 }}><View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.label}>Zoom</Text><Text style={styles.small}>{Math.round(crop.zoom * 100)}%</Text></View>
      <PhotoZoom value={crop.zoom} onChange={zoom} disabled={!loaded?.source} />
    </View>
    <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={[styles.small, { flex: 1 }]}>This crop stays the same on every board tile.{Platform.OS === 'web' ? ' Arrow keys also move the photo.' : ''}</Text><Button kind="ghost" icon={RotateCcw} onPress={() => onChange({ ...photo, zoom: 1, x: 0, y: 0 })}>Reset crop</Button></View>
  </View>;
}
