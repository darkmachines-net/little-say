/** @file Imports local tile photos through the platform picker and normalizes them for durable storage. */

import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { type Tile } from '@little-say/core';
import { saveAsset } from '../data/storage';

export type TilePhoto = Extract<Tile['illustration'], { kind: 'photo' }>;

/**
 * Open the image picker with native cropping where supported, resize large photos, and save a JPEG
 * locally. Return null when selection is cancelled.
 */
export async function chooseTilePhoto(): Promise<TilePhoto | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsMultipleSelection: false,
    allowsEditing: Platform.OS !== 'web', aspect: [1, 1], quality: 1,
    presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
    shouldDownloadFromNetwork: true,
  });
  if (picked.canceled) return null;
  const source = picked.assets[0];
  if (!source?.width || !source.height) throw new Error('This photo could not be opened. Try another image.');
  const context = ImageManipulator.manipulate(source.uri);
  let image: ImageRef | undefined;
  try {
    // Keep enough detail for faces without storing full-resolution camera files.
    // On native the picker has already applied the parent's crop.
    if (Math.max(source.width, source.height) > 1600) context.resize(source.width >= source.height ? { width: 1600 } : { height: 1600 });
    image = await context.renderAsync();
    const result = await image.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
    const id = Crypto.randomUUID();
    await saveAsset(id, result.uri);
    return { kind: 'photo', assetId: id, zoom: 1, x: 0, y: 0 };
  } finally { image?.release(); context.release(); }
}
