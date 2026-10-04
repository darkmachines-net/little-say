import { openDB } from 'idb';
import { migrateLibrary, speechAssetIdSchema, type SpeechAsset, type Library } from '@little-say/core';
import { downloadAudio } from './audioDownload';
const database = openDB('little-say', 2, { upgrade(db, oldVersion) {
  if (oldVersion < 1) { db.createObjectStore('state'); db.createObjectStore('photos'); }
  if (oldVersion < 2) db.createObjectStore('speech');
} });
const urls = new Map<string, string>();
export async function loadLibrary(): Promise<Library | null> {
  const value = await (await database).get('state', 'library');
  return value ? migrateLibrary(value) : null;
}
export async function saveLibrary(value: Library): Promise<void> {
  const db = await database;
  const tx = db.transaction('state', 'readwrite');
  await tx.store.put(migrateLibrary(value), 'library');
  await tx.done;
}
export async function saveAsset(id: string, uri: string): Promise<void> {
  const blob = await (await fetch(uri)).blob();
  await (await database).put('photos', blob, id);
}
export async function assetUri(id: string): Promise<string | null> {
  if (urls.has(id)) return urls.get(id)!;
  const blob = await (await database).get('photos', id) as Blob | undefined;
  if (!blob) return null;
  const uri = URL.createObjectURL(blob); urls.set(id, uri); return uri;
}
export async function pruneAssets(keep: Set<string>): Promise<void> {
  const db = await database;
  for (const id of await db.getAllKeys('photos')) if (!keep.has(String(id))) {
    await db.delete('photos', id);
    const uri = urls.get(String(id)); if (uri) URL.revokeObjectURL(uri);
    urls.delete(String(id));
  }
}
export async function requestPersistence(): Promise<boolean> { return navigator.storage?.persist ? navigator.storage.persist() : false; }

const audioUrls = new Map<string, string>();
function audioAsset(id: string, blob: Blob): SpeechAsset {
  let uri = audioUrls.get(id);
  if (!uri) { uri = URL.createObjectURL(blob); audioUrls.set(id, uri); }
  return { id, uri };
}
export async function loadSpeechAssets(): Promise<Record<string, SpeechAsset>> {
  const db = await database;
  const assets: Record<string, SpeechAsset> = {};
  for (const key of await db.getAllKeys('speech')) {
    const record = await db.get('speech', key) as { id: string; blob: Blob };
    if (speechAssetIdSchema.safeParse(record.id).success && record.blob instanceof Blob) assets[String(key)] = audioAsset(record.id, record.blob);
  }
  return assets;
}
export async function saveSpeechAsset(key: string, id: string, url: string): Promise<SpeechAsset> {
  speechAssetIdSchema.parse(id);
  const bytes = await downloadAudio(url);
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
  await (await database).put('speech', { id, blob }, key);
  return audioAsset(id, blob);
}
