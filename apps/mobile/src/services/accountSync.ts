/** @file Exchanges complete account snapshots and content-addressed assets while keeping local edits and offline playback safe. */

import * as Crypto from 'expo-crypto';
import { boardAssetKeys, mergeAssets, mergeBoards, syncSnapshotSchema, type Board, type Library, type SyncAsset, type SyncSnapshot } from '@little-say/core';
import * as storage from '../data/storage';
import { apiFetch } from './api';
import { type AccountSession } from './accountSession';

/** Call only the session's original server; browsers send their HttpOnly cookie and native sends its token. */
export async function accountRequest(session: AccountSession, path: string, body?: unknown, signal?: AbortSignal) {
  return apiFetch(session.server, `/api/account${path}`, {
    credentials: 'include', method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Little-Say-Account': session.account.id, ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, signal, true);
}
/** Compute the shared SHA-256 asset identity on both native and web. */
export async function assetHash(bytes: Uint8Array) {
  const hash = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
function encode(bytes: Uint8Array) {
  let text = ''; for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
function decode(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
async function localAssets(boards: Board[]) {
  const required = boardAssetKeys(boards);
  const candidates: Pick<SyncAsset, 'kind' | 'id' | 'key'>[] = [...required.images].map(key => {
    const [kind, id] = key.split(':'); return { kind: kind as 'photo' | 'picture', id };
  });
  const audio = await storage.loadSpeechAssets();
  for (const key of required.speech) if (audio[key]) candidates.push({ kind: 'speech', id: audio[key].id, key });
  const assets: SyncAsset[] = [];
  for (const asset of candidates) {
    const bytes = await storage.readSyncAsset(asset);
    if (bytes) assets.push({ ...asset, hash: await assetHash(bytes) });
  }
  return assets;
}

/** Upload missing local assets, restore missing remote files, and commit a revision-checked complete backup. */
export async function syncAccount(library: Library, session: AccountSession, signal: AbortSignal): Promise<SyncSnapshot> {
  const remote = syncSnapshotSchema.parse(await accountRequest(session, '/backup', undefined, signal));
  const baseline = library.sync?.accountId === session.account.id && library.sync.server === session.server ? library.sync.snapshot : { revision: 0, boards: [], assets: [] };
  const local = await localAssets(library.boards);
  // Stable conflict IDs make retry after a lost commit response idempotent.
  const conflictIds = new Map(await Promise.all(library.boards.map(async board => [board.id, `conflict_${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(board))}`] as const)));
  const boards = mergeBoards(baseline.boards, library.boards, remote.boards, board => conflictIds.get(board.id)!);
  const assets = mergeAssets(boards, baseline.assets, local, remote.assets);
  const available = new Set(remote.assets.map(asset => asset.hash));
  for (const asset of assets) {
    if (signal.aborted) throw new Error('Sync cancelled. Your local boards are unchanged.');
    const bytes = await storage.readSyncAsset(asset);
    if (bytes && await assetHash(bytes) === asset.hash) {
      if (!available.has(asset.hash)) {
        if (bytes.length > 10 * 1024 * 1024) throw new Error('A picture or audio file exceeds the 10 MB backup limit.');
        await accountRequest(session, `/assets/${asset.hash}`, { data: encode(bytes) }, signal); available.add(asset.hash);
      }
      // A native file may exist while its pronunciation index still points at a different take.
      if (asset.kind === 'speech' && !local.some(item => item.key === asset.key && item.id === asset.id)) await storage.writeSyncAsset(asset, bytes);
    } else {
      const response = await accountRequest(session, `/assets/${asset.hash}`, undefined, signal);
      if (typeof response.data !== 'string' || response.data.length > 14 * 1024 * 1024) throw new Error('A backup file could not be read.');
      const restored = decode(response.data);
      if (await assetHash(restored) !== asset.hash) throw new Error('A backup file failed verification. Please try syncing again.');
      await storage.writeSyncAsset(asset, restored);
    }
  }
  const next = syncSnapshotSchema.parse({ revision: remote.revision, boards, assets });
  // A read-only pull does not consume a revision or contend with other devices.
  return JSON.stringify({ ...next, revision: 0 }) === JSON.stringify({ ...remote, revision: 0 }) ? remote : syncSnapshotSchema.parse(await accountRequest(session, '/backup', next, signal));
}
