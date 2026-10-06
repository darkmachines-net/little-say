/** @file Renders a locally saved illustration without cropping and reports missing offline assets honestly. */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Text, View } from 'react-native';
import { ImageOff } from 'lucide-react-native';
import { pictureUri } from '../data/storage';
import { theme } from './theme';

/** Resolve an immutable PNG locally and contain its full subject within the tile; ignore stale loads. */
export function PictureImage({ assetId }: { assetId: string }) {
  const [source, setSource] = useState<{ id: string; uri: string | null } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => { let active = true; void pictureUri(assetId).then(uri => { if (active) setSource({ id: assetId, uri }); }).catch(() => { if (active) setSource({ id: assetId, uri: null }); }); return () => { active = false; }; }, [assetId]);
  if (source?.id !== assetId) return <ActivityIndicator color={theme.muted} />;
  return source.uri && failed !== assetId ? <Image testID="card-picture" accessible={false} source={{ uri: source.uri }} resizeMode="contain" onError={() => setFailed(assetId)} style={{ width: '100%', height: '100%' }} /> : <View style={{ alignItems: 'center', gap: 6 }}><ImageOff color={theme.muted} size={28} /><Text style={{ color: theme.muted, fontSize: 12 }}>Picture unavailable</Text></View>;
}
