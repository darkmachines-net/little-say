/** @file Owns offline browser library and media storage in IndexedDB, including reusable blob URLs. */

import { openDB } from 'idb';
import { migrateLibrary, speechAssetIdSchema, type SpeechAsset, type Library } from '@little-say/core';
import { downloadAudio } from './audioDownload';
import { downloadPicture } from './pictureDownload';
import { pictureAssetIdSchema } from '@little-say/core';
import { syncAssetSchema, type SyncAsset } from '@little-say/core';
const database = openDB('little-say', 3, { upgrade(db, oldVersion) {
  if (oldVersion < 1) { db.createObjectStore('state'); db.createObjectStore('photos'); }
  if (oldVersion < 2) db.createObjectStore('speech');
  if (oldVersion < 3) db.createObjectStore('pictures');
} });
const urls = new Map<string, string>();
/** Read and validate the browser library, returning null on first use and rejecting invalid saved data. */
export async function loadLibrary(): Promise<Library | null> {
  const value = await (await database).get('state', 'library');
  return value ? migrateLibrary(value) : null;
}
/** Validate and replace the library, resolving only when the IndexedDB transaction completes. */
export async function saveLibrary(value: Library): Promise<void> {
  const db = await database;
  const tx = db.transaction('state', 'readwrite');
  await tx.store.put(migrateLibrary(value), 'library');
  await tx.done;
}
/** Fetch a selected image URI and store its blob under the local photo ID. */
export async function saveAsset(id: string, uri: string): Promise<void> {
  const blob = await (await fetch(uri)).blob();
  await (await database).put('photos', blob, id);
}
/** Return a reusable blob URL for a stored photo, or null when no photo exists for the ID. */
export async function assetUri(id: string): Promise<string | null> {
  if (urls.has(id)) return urls.get(id)!;
  const blob = await (await database).get('photos', id) as Blob | undefined;
  if (!blob) return null;
  const uri = URL.createObjectURL(blob); urls.set(id, uri); return uri;
}

const pictureUrls = new Map<string, string>();
/** Download a verified PNG before saving its local board reference; existing assets are reused. */
export async function savePictureAsset(id: string, url: string, signal?: AbortSignal): Promise<void> {
  pictureAssetIdSchema.parse(id);
  const db = await database; if (await db.get('pictures', id)) return;
  const bytes = await downloadPicture(id, url, signal);
  await db.put('pictures', new Blob([bytes], { type: 'image/png' }), id);
}
/** Resolve a locally stored illustration to a reusable blob URL for offline rendering. */
export async function pictureUri(id: string): Promise<string | null> {
  pictureAssetIdSchema.parse(id);
  if (pictureUrls.has(id)) return pictureUrls.get(id)!;
  const blob = await (await database).get('pictures', id) as Blob | undefined; if (!blob) return null;
  const uri = URL.createObjectURL(blob); pictureUrls.set(id, uri); return uri;
}
/** Prune unreferenced PNG blobs and revoke their URLs; retained IDs must include drafts and undo. */
export async function prunePictures(keep: Set<string>): Promise<void> {
  const db = await database;
  for (const key of await db.getAllKeys('pictures')) if (!keep.has(String(key))) {
    await db.delete('pictures', key);
    const uri = pictureUrls.get(String(key)); if (uri) URL.revokeObjectURL(uri); pictureUrls.delete(String(key));
  }
}
/** Delete unreferenced photo blobs and revoke their cached object URLs. */
export async function pruneAssets(keep: Set<string>): Promise<void> {
  const db = await database;
  for (const id of await db.getAllKeys('photos')) if (!keep.has(String(id))) {
    await db.delete('photos', id);
    const uri = urls.get(String(id)); if (uri) URL.revokeObjectURL(uri);
    urls.delete(String(id));
  }
}
const audioUrls = new Map<string, string>();
function audioAsset(id: string, blob: Blob): SpeechAsset {
  let uri = audioUrls.get(id);
  if (!uri) { uri = URL.createObjectURL(blob); audioUrls.set(id, uri); }
  return { id, uri };
}
/** Restore valid cached speech blobs as playable object URLs indexed by speech key. */
export async function loadSpeechAssets(): Promise<Record<string, SpeechAsset>> {
  const db = await database;
  const assets: Record<string, SpeechAsset> = {};
  for (const key of await db.getAllKeys('speech')) {
    const record = await db.get('speech', key) as { id: string; blob: Blob };
    if (speechAssetIdSchema.safeParse(record.id).success && record.blob instanceof Blob) assets[String(key)] = audioAsset(record.id, record.blob);
  }
  return assets;
}
/** Validate and download a speech clip, persist its blob, and return a reusable playable object URL. */
export async function saveSpeechAsset(key: string, id: string, url: string): Promise<SpeechAsset> {
  speechAssetIdSchema.parse(id);
  const bytes = await downloadAudio(url);
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
  await (await database).put('speech', { id, blob }, key);
  return audioAsset(id, blob);
}

/** Read IndexedDB blobs directly for backup; object URLs and browser paths never leave this device. */
export async function readSyncAsset(asset: Pick<SyncAsset, 'kind' | 'id' | 'key'>): Promise<Uint8Array | null> {
  syncAssetSchema.parse({ ...asset, hash: '0'.repeat(64) });
  const db = await database;
  const value = await db.get(asset.kind === 'photo' ? 'photos' : asset.kind === 'picture' ? 'pictures' : 'speech', asset.key ?? asset.id);
  const blob = asset.kind === 'speech' ? value?.id === asset.id ? value.blob : null : value;
  return blob instanceof Blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** Store restored image/audio blobs and refresh object URLs before boards become visible. */
export async function writeSyncAsset(asset: SyncAsset, bytes: Uint8Array): Promise<void> {
  syncAssetSchema.parse(asset);
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: asset.kind === 'photo' ? 'image/jpeg' : asset.kind === 'picture' ? 'image/png' : 'audio/wav' });
  await (await database).put(asset.kind === 'photo' ? 'photos' : asset.kind === 'picture' ? 'pictures' : 'speech', asset.kind === 'speech' ? { id: asset.id, blob } : blob, asset.key ?? asset.id);
  const cache = asset.kind === 'photo' ? urls : asset.kind === 'picture' ? pictureUrls : audioUrls;
  const uri = cache.get(asset.id); if (uri) URL.revokeObjectURL(uri); cache.delete(asset.id);
}
