/** @file Persists the native library in SQLite and keeps photo and speech files in app document storage. */

import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { Directory, File, Paths } from 'expo-file-system';
import { migrateLibrary, speechAssetIdSchema, type SpeechAsset, type Library } from '@little-say/core';
import { downloadAudio } from './audioDownload';
import { downloadPicture } from './pictureDownload';
import { pictureAssetIdSchema } from '@little-say/core';
import { syncAssetSchema, type SyncAsset } from '@little-say/core';

const database = SQLite.openDatabaseAsync('little-say.db').then(async db => {
  await db.execAsync('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS speech (key TEXT PRIMARY KEY, asset_id TEXT NOT NULL);');
  return db;
});
const directory = `${FileSystem.documentDirectory}tile-photos/`;
/**
 * Read and validate the saved library, returning null on first use and rejecting corrupt or unreadable
 * data.
 */
export async function loadLibrary(): Promise<Library | null> {
  const row = await (await database).getFirstAsync<{ document: string }>('SELECT document FROM state WHERE id = 1');
  return row ? migrateLibrary(JSON.parse(row.document)) : null;
}
/** Validate and transactionally replace the saved library document in SQLite. */
export async function saveLibrary(value: Library): Promise<void> {
  const db = await database;
  const json = JSON.stringify(migrateLibrary(value));
  await db.withExclusiveTransactionAsync(async tx => { await tx.runAsync('INSERT INTO state (id, document) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET document = excluded.document', json); });
}
/** Copy a selected photo into app document storage under its local asset ID. */
export async function saveAsset(id: string, uri: string): Promise<void> {
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  await FileSystem.copyAsync({ from: uri, to: `${directory}${id}.jpg` });
}
/** Resolve a stored photo ID to a native file URI, or null if its file is missing. */
export async function assetUri(id: string): Promise<string | null> {
  const path = `${directory}${id}.jpg`;
  return (await FileSystem.getInfoAsync(path)).exists ? path : null;
}

/** Store a verified transparent PNG in its own directory before committing a board reference. */
export async function savePictureAsset(id: string, url: string, signal?: AbortSignal): Promise<void> {
  pictureAssetIdSchema.parse(id);
  const folder = new Directory(Paths.document, 'tile-pictures'); folder.create({ intermediates: true, idempotent: true });
  const file = new File(folder, `${id}.png`);
  if (!file.exists) file.write(await downloadPicture(id, url, signal));
}
/** Resolve a saved illustration, independent of the JPEG photo/crop store. */
export async function pictureUri(id: string): Promise<string | null> {
  pictureAssetIdSchema.parse(id);
  const file = new File(Paths.document, 'tile-pictures', `${id}.png`); return file.exists ? file.uri : null;
}
/** Prune only unreferenced illustration files; callers must include drafts and undo references. */
export async function prunePictures(keep: Set<string>): Promise<void> {
  const folder = new Directory(Paths.document, 'tile-pictures'); if (!folder.exists) return;
  for (const file of folder.list()) if (file instanceof File && file.name.endsWith('.png') && !keep.has(file.name.slice(0, -4))) file.delete();
}
/** Delete stored photos whose IDs are absent from the retained set. */
export async function pruneAssets(keep: Set<string>): Promise<void> {
  if (!(await FileSystem.getInfoAsync(directory)).exists) return;
  for (const file of await FileSystem.readDirectoryAsync(directory)) {
    if (file.endsWith('.jpg') && !keep.has(file.slice(0, -4))) await FileSystem.deleteAsync(`${directory}${file}`, { idempotent: true });
  }
}
/** Return true because native document storage needs no browser-style persistence request. */
export async function requestPersistence(): Promise<boolean> { return true; }

/** Restore the speech-key index, skipping invalid IDs and audio files that no longer exist. */
export async function loadSpeechAssets(): Promise<Record<string, SpeechAsset>> {
  const rows = await (await database).getAllAsync<{ key: string; asset_id: string }>('SELECT key, asset_id FROM speech');
  const assets: Record<string, SpeechAsset> = {};
  for (const row of rows) {
    if (!speechAssetIdSchema.safeParse(row.asset_id).success) continue;
    const file = new File(Paths.document, 'tile-audio', `${row.asset_id}.wav`);
    if (file.exists) assets[row.key] = { id: row.asset_id, uri: file.uri };
  }
  return assets;
}
/**
 * Download a clip when its file is absent, then persist its speech-key mapping and return the playable
 * local asset.
 */
export async function saveSpeechAsset(key: string, id: string, url: string): Promise<SpeechAsset> {
  speechAssetIdSchema.parse(id);
  const directory = new Directory(Paths.document, 'tile-audio');
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, `${id}.wav`);
  if (!file.exists) file.write(await downloadAudio(url));
  await (await database).runAsync('INSERT INTO speech (key, asset_id) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET asset_id = excluded.asset_id', key, id);
  return { id, uri: file.uri };
}

/** Read owned document bytes for backup without exposing native paths to the server. */
export async function readSyncAsset(asset: Pick<SyncAsset, 'kind' | 'id' | 'key'>): Promise<Uint8Array | null> {
  syncAssetSchema.parse({ ...asset, hash: '0'.repeat(64) });
  const folder = asset.kind === 'photo' ? 'tile-photos' : asset.kind === 'picture' ? 'tile-pictures' : 'tile-audio';
  const extension = asset.kind === 'photo' ? 'jpg' : asset.kind === 'picture' ? 'png' : 'wav';
  const file = new File(Paths.document, folder, `${asset.id}.${extension}`);
  return file.exists ? file.bytes() : null;
}

/** Restore verified backup bytes before publishing board references; persist speech-key mappings too. */
export async function writeSyncAsset(asset: SyncAsset, bytes: Uint8Array): Promise<void> {
  syncAssetSchema.parse(asset);
  const folder = new Directory(Paths.document, asset.kind === 'photo' ? 'tile-photos' : asset.kind === 'picture' ? 'tile-pictures' : 'tile-audio');
  folder.create({ intermediates: true, idempotent: true });
  const extension = asset.kind === 'photo' ? 'jpg' : asset.kind === 'picture' ? 'png' : 'wav';
  new File(folder, `${asset.id}.${extension}`).write(bytes);
  if (asset.kind === 'speech') await (await database).runAsync('INSERT INTO speech (key, asset_id) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET asset_id = excluded.asset_id', asset.key!, asset.id);
}
