/** @file Verifies origin-bound account requests, shared-device isolation, transfer integrity, complete backups, and retry-safe conflict copies. */

import { beforeEach, expect, it, vi } from 'vitest';
import { starterLibrary } from '../../../../tests/fixtures/library';
import { type SyncSnapshot } from '@little-say/core';

const mocks = vi.hoisted(() => ({ request: vi.fn(), read: vi.fn(), write: vi.fn(), audio: vi.fn(), pruneAssets: vi.fn(), prunePictures: vi.fn(), pruneSpeech: vi.fn() }));
vi.mock('./firebaseAccount', () => ({ accountAuthHeaders: async () => ({ Authorization: 'Bearer native-token' }) }));
vi.mock('./api', () => ({ apiFetch: mocks.request }));
vi.mock('../data/storage', () => ({ readSyncAsset: mocks.read, writeSyncAsset: mocks.write, loadSpeechAssets: mocks.audio, pruneAssets: mocks.pruneAssets, prunePictures: mocks.prunePictures, pruneSpeech: mocks.pruneSpeech }));
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: (algorithm: string, bytes: Uint8Array<ArrayBuffer>) => crypto.subtle.digest(algorithm, bytes), digestStringAsync: async (algorithm: string, input: string) => Array.from(new Uint8Array(await crypto.subtle.digest(algorithm, new TextEncoder().encode(input))), byte => byte.toString(16).padStart(2, '0')).join('') }));
import { accountRequest, ownedByOtherAccount, pruneLocalMedia, syncAccount } from './accountSync';

const session = { account: { id: '31c14723-81d1-40a1-9f81-907814c090a1', email: 'parent@example.test', displayName: null, emailVerified: true, providers: ['password'] }, firebaseUid: 'parent', authConfig: { projectId: 'demo-little-say', apiKey: 'demo-key', appId: 'demo-app', authDomain: 'demo-little-say.firebaseapp.com', providers: ['password' as const] }, server: 'https://original.example' };
const signal = () => new AbortController().signal;
beforeEach(() => { vi.clearAllMocks(); mocks.audio.mockResolvedValue({}); mocks.read.mockResolvedValue(null); mocks.write.mockResolvedValue(undefined); mocks.pruneAssets.mockResolvedValue(undefined); mocks.prunePictures.mockResolvedValue(undefined); mocks.pruneSpeech.mockResolvedValue(undefined); });

it('pins native credentials to the original server even when backend configuration changes', async () => {
  await accountRequest(session, '/logout', {});
  expect(mocks.request).toHaveBeenCalledWith(session.server, '/api/account/logout', expect.objectContaining({ credentials: 'include', headers: expect.objectContaining({ Authorization: 'Bearer native-token', 'X-Little-Say-Account': session.account.id }) }), undefined, true);
});

it('does not publish a backup when an asset upload fails', async () => {
  const library = starterLibrary(); library.boards = [library.boards[0]];
  library.boards[0].tiles[0].illustration = { kind: 'photo', assetId: 'photo', zoom: 1, x: 0, y: 0 };
  mocks.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.request.mockImplementation(async (_server, path, init) => {
    if (path === '/api/account/backup' && init.method === 'GET') return { revision: 0, boards: [], assets: [] };
    throw new Error('Offline');
  });
  const before = structuredClone(library);
  await expect(syncAccount(library, session, signal())).rejects.toThrow('Offline');
  expect(library).toEqual(before);
  expect(mocks.request.mock.calls.some(([, path, init]) => path === '/api/account/backup' && init.method === 'POST')).toBe(false);
});

it('rejects corrupted remote bytes before writing files or accepting a backup', async () => {
  const library = starterLibrary(); const board = library.boards[0]; library.boards = [];
  board.tiles[0].illustration = { kind: 'photo', assetId: 'photo', zoom: 1, x: 0, y: 0 };
  mocks.request.mockImplementation(async (_server, path) => path === '/api/account/backup' ? { revision: 1, boards: [board], assets: [{ kind: 'photo', id: 'photo', hash: 'a'.repeat(64) }] } : { data: 'aGVsbG8=' });
  await expect(syncAccount(library, session, signal())).rejects.toThrow('verification');
  expect(mocks.write).not.toHaveBeenCalled(); expect(library.boards).toEqual([]);
});

it('retries a lost commit response without duplicating conflict boards', async () => {
  const library = starterLibrary(); library.boards = [library.boards[0]];
  library.sync = { accountId: session.account.id, server: session.server, savedAt: '', snapshot: { revision: 1, boards: structuredClone(library.boards), assets: [] } };
  library.boards[0].title = 'Local edit';
  let remote: SyncSnapshot = { revision: 2, boards: [{ ...library.boards[0], title: 'Remote edit' }], assets: [] };
  mocks.request.mockImplementation(async (_server, _path, init) => {
    if (init.method === 'GET') return remote;
    remote = { ...JSON.parse(init.body), revision: remote.revision + 1 };
    throw new Error('Response lost');
  });
  await expect(syncAccount(library, session, signal())).rejects.toThrow('Response lost');
  expect(remote.boards).toHaveLength(2);
  const result = await syncAccount(library, session, signal());
  expect(result.boards).toHaveLength(2); expect(result).toEqual(remote);
});

it('never merges or uploads boards or private assets belonging to another account on the same device', async () => {
  const library = starterLibrary();
  const privateBoard = { ...library.boards[0], id: 'account-a-board', title: 'Private family board' };
  privateBoard.tiles[0] = { ...privateBoard.tiles[0], illustration: { kind: 'photo', assetId: 'family-photo', zoom: 1, x: 0, y: 0 } };
  library.boards = [privateBoard];
  library.sync = { accountId: '00000000-0000-4000-8000-000000000099', server: session.server, savedAt: new Date().toISOString(), snapshot: { revision: 1, boards: [privateBoard], assets: [] } };
  expect(ownedByOtherAccount(library, session.account.id, session.server)).toBe(true);
  expect(ownedByOtherAccount(library, '00000000-0000-4000-8000-000000000099', session.server)).toBe(false);
  expect(ownedByOtherAccount({ ...library, sync: undefined }, session.account.id, session.server)).toBe(false);

  const accountBBoard = { ...starterLibrary().boards[0], id: 'account-b-board', title: 'Account B board' };
  const remote: SyncSnapshot = { revision: 3, boards: [accountBBoard], assets: [] };
  mocks.read.mockResolvedValue(new Uint8Array([9, 8, 7]));
  mocks.request.mockResolvedValue(remote);

  const result = await syncAccount(library, session, signal());
  expect(result).toEqual(remote);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.request.mock.calls.filter(([, , init]) => init.method === 'POST')).toEqual([]);
});

it('prunes local photos, pictures, and speech clips not referenced by retained boards', async () => {
  const board = starterLibrary().boards[0];
  board.tiles[0].illustration = { kind: 'photo', assetId: 'keep-photo', zoom: 1, x: 0, y: 0 };
  board.tiles[1].illustration = { kind: 'generated', assetId: 'a'.repeat(64), style: 'color', description: 'Keep', model: 'fixture' };
  await pruneLocalMedia([board]);
  expect(mocks.pruneAssets).toHaveBeenCalledWith(new Set(['keep-photo']));
  expect(mocks.prunePictures).toHaveBeenCalledWith(new Set(['a'.repeat(64)]));
  expect(mocks.pruneSpeech).toHaveBeenCalledOnce();
});
