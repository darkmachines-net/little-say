import { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { photoGeometry, type PhotoCrop, type PhotoSize } from '@little-say/core';
import { assetUri } from '../data/storage';

export type PhotoSource = PhotoSize & { uri: string };
export function usePhotoSource(assetId: string | null) {
  const [loaded, setLoaded] = useState<{ id: string; source?: PhotoSource; error?: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    if (assetId) void assetUri(assetId).then(uri => {
      if (!live) return;
      if (!uri) { setLoaded({ id: assetId, error: true }); return; }
      Image.getSize(uri, (width, height) => { if (live) setLoaded(width && height ? { id: assetId, source: { uri, width, height } } : { id: assetId, error: true }); }, () => { if (live) setLoaded({ id: assetId, error: true }); });
    }).catch(() => { if (live) setLoaded({ id: assetId, error: true }); });
    return () => { live = false; };
  }, [assetId]);
  return loaded?.id === assetId ? loaded : null;
}

export function PhotoImage({ source, frame, crop, onError }: { source: PhotoSource; frame: PhotoSize; crop: PhotoCrop; onError?: () => void }) {
  return <Image testID="photo-image" accessible={false} source={{ uri: source.uri }} resizeMode="stretch" onError={onError} style={{ position: 'absolute', ...photoGeometry(source, frame, crop) }} />;
}
