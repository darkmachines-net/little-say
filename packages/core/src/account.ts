/** @file Defines account sync contracts, retaining board edits and saved pronunciation assets across play subsets. */

import { z } from 'zod';
import { type Board, type SyncAsset } from './schema';
import { boardAudioTiles } from './boardLanguages';
import { speechKey } from './speech';

export const accountSchema = z.object({ id: z.string().uuid(), email: z.string().nullable(), displayName: z.string().nullable(), emailVerified: z.boolean(), providers: z.array(z.string()), deletionPending: z.boolean().optional() });
export const sessionSchema = z.object({ account: accountSchema });
export const authConfigSchema = z.object({ projectId: z.string(), apiKey: z.string(), appId: z.string(), authDomain: z.string(), providers: z.array(z.enum(['password', 'google.com', 'apple.com'])), emulatorUrl: z.string().optional(), googleWebClientId: z.string().optional(), googleIosClientId: z.string().optional(), appleServiceId: z.string().optional(), appleRedirectUri: z.string().optional() });
export type AuthConfig = z.infer<typeof authConfigSchema>;
export type Account = z.infer<typeof accountSchema>;

function same(a: Board | undefined, b: Board | undefined) { return JSON.stringify(a) === JSON.stringify(b); }

/** Merge against the last acknowledgement; retain concurrent edits as copies and rescue edits racing deletion. */
export function mergeBoards(base: Board[], local: Board[], remote: Board[], id: (board: Board) => string): Board[] {
  const before = new Map(base.map(board => [board.id, board]));
  const here = new Map(local.map(board => [board.id, board]));
  const there = new Map(remote.map(board => [board.id, board]));
  const merged: Board[] = [];
  for (const key of new Set([...here.keys(), ...there.keys(), ...before.keys()])) {
    const b = before.get(key), l = here.get(key), r = there.get(key);
    if (same(l, r)) { if (l) merged.push(l); }
    else if (same(l, b)) { if (r) merged.push(r); }
    else if (same(r, b)) { if (l) merged.push(l); }
    else {
      if (r) merged.push(r);
      if (l) {
        const copyId = id(l);
        if (!there.has(copyId) && !here.has(copyId)) merged.push({ ...l, id: copyId, title: `${l.title.slice(0, 80)} (conflict copy)` });
      }
    }
  }
  return merged;
}

/** Retain image references and every current saved pronunciation, including languages excluded from play. */
export function boardAssetKeys(boards: Board[]) {
  const images = new Set(boards.flatMap(board => board.tiles.flatMap(tile => {
    const picture = tile.illustration;
    return picture.kind === 'photo' ? [`photo:${picture.assetId}`] : picture.kind === 'library' || picture.kind === 'generated' ? [`picture:${picture.assetId}`] : [];
  })));
  const speech = new Set(boards.flatMap(board => boardAudioTiles({ ...board, playLanguages: [...new Set(board.tiles.flatMap(tile => [tile.language, ...(tile.translations ?? []).map(translation => translation.language)]))] })).map(tile => speechKey({ text: tile.speech, language: tile.language })));
  return { images, speech };
}

/** Merge immutable images and pronunciation selections; upload only assets referenced by retained boards. */
export function mergeAssets(boards: Board[], base: SyncAsset[], local: SyncAsset[], remote: SyncAsset[]): SyncAsset[] {
  const identity = (asset: SyncAsset) => `${asset.kind}:${asset.key ?? asset.id}`;
  const result = new Map(remote.map(asset => [identity(asset), asset]));
  for (const asset of local) {
    const key = identity(asset), previous = base.find(item => identity(item) === key), other = result.get(key);
    if (asset.kind !== 'speech' && other && other.hash !== asset.hash) throw new Error('A picture has conflicting file contents. Your boards have not been replaced.');
    if (!other || asset.hash !== previous?.hash) result.set(key, asset);
  }
  const required = boardAssetKeys(boards);
  const assets = [...result.values()].filter(asset => asset.kind === 'speech' ? required.speech.has(asset.key!) : required.images.has(identity(asset)));
  for (const key of required.images) if (!assets.some(asset => identity(asset) === key)) throw new Error('A board picture is missing from this device and its backup. Restore the picture before syncing.');
  return assets;
}
