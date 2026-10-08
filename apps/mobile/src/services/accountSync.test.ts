/** @file Verifies origin-bound account requests, transfer integrity, complete backups, and retry-safe conflict copies. */

import { beforeEach, expect, it, vi } from 'vitest';
import { starterLibrary } from '../../../../tests/fixtures/library';
import { type SyncSnapshot } from '@little-say/core';

const mocks = vi.hoisted(() => ({ request: vi.fn(), read: vi.fn(), write: vi.fn(), audio: vi.fn() }));
vi.mock('./firebaseAccount', () => ({ accountAuthHeaders: async () => ({ Authorization: 'Bearer native-token' }) }));
vi.mock('./api', () => ({ apiFetch: mocks.request }));
vi.mock('../data/storage', () => ({ readSyncAsset: mocks.read, writeSyncAsset: mocks.write, loadSpeechAssets: mocks.audio }));
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: (algorithm: string, bytes: Uint8Array<ArrayBuffer>) => crypto.subtle.digest(algorithm, bytes), digestStringAsync: async (algorithm: string, input: string) => Array.from(new Uint8Array(await crypto.subtle.digest(algorithm, new TextEncoder().encode(input))), byte => byte.toString(16).padStart(2, '0')).join('') }));
import { accountRequest, syncAccount } from './accountSync';

const session = { account: { id: '31c14723-81d1-40a1-9f81-907814c090a1', email: 'parent@example.test', displayName: null, emailVerified: true, providers: ['password'] }, firebaseUid: 'parent', authConfig: { projectId: 'demo-little-say', apiKey: 'demo-key', appId: 'demo-app', authDomain: 'demo-little-say.firebaseapp.com', providers: ['password' as const] }, server: 'https://original.example' };
const signal = () => new AbortController().signal;
beforeEach(() => { vi.clearAllMocks(); mocks.audio.mockResolvedValue({}); mocks.read.mockResolvedValue(null); mocks.write.mockResolvedValue(undefined); });

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
