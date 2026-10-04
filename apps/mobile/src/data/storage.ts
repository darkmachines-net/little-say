import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { Directory, File, Paths } from 'expo-file-system';
import { migrateLibrary, speechAssetIdSchema, type SpeechAsset, type Library } from '@little-say/core';
import { downloadAudio } from './audioDownload';

const database = SQLite.openDatabaseAsync('little-say.db').then(async db => {
  await db.execAsync('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS speech (key TEXT PRIMARY KEY, asset_id TEXT NOT NULL);');
  return db;
});
const directory = `${FileSystem.documentDirectory}tile-photos/`;
export async function loadLibrary(): Promise<Library | null> {
  const row = await (await database).getFirstAsync<{ document: string }>('SELECT document FROM state WHERE id = 1');
  return row ? migrateLibrary(JSON.parse(row.document)) : null;
}
export async function saveLibrary(value: Library): Promise<void> {
  const db = await database;
  const json = JSON.stringify(migrateLibrary(value));
  await db.withExclusiveTransactionAsync(async tx => { await tx.runAsync('INSERT INTO state (id, document) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET document = excluded.document', json); });
}
export async function saveAsset(id: string, uri: string): Promise<void> {
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  await FileSystem.copyAsync({ from: uri, to: `${directory}${id}.jpg` });
}
export async function assetUri(id: string): Promise<string | null> {
  const path = `${directory}${id}.jpg`;
  return (await FileSystem.getInfoAsync(path)).exists ? path : null;
}
export async function pruneAssets(keep: Set<string>): Promise<void> {
  if (!(await FileSystem.getInfoAsync(directory)).exists) return;
  for (const file of await FileSystem.readDirectoryAsync(directory)) {
    if (file.endsWith('.jpg') && !keep.has(file.slice(0, -4))) await FileSystem.deleteAsync(`${directory}${file}`, { idempotent: true });
  }
}
export async function requestPersistence(): Promise<boolean> { return true; }

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
export async function saveSpeechAsset(key: string, id: string, url: string): Promise<SpeechAsset> {
  speechAssetIdSchema.parse(id);
  const directory = new Directory(Paths.document, 'tile-audio');
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, `${id}.wav`);
  if (!file.exists) file.write(await downloadAudio(url));
  await (await database).runAsync('INSERT INTO speech (key, asset_id) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET asset_id = excluded.asset_id', key, id);
  return { id, uri: file.uri };
}
