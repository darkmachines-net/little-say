/** @file Verifies serialized saves, optimistic retry, durable commit visibility, and creation-draft asset retention. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultPicturePolicy, migrateDeviceSettings, type Library } from '@little-say/core';
import { starterLibrary } from '../../../../tests/fixtures/library';
import { useLibrary } from './useLibrary';

const storage = vi.hoisted(() => ({ loadLibrary: vi.fn(), saveLibrary: vi.fn(), pruneAssets: vi.fn(), prunePictures: vi.fn() }));
vi.mock('./storage', () => storage);
let screen: ReactTestRenderer | undefined;
let store: ReturnType<typeof useLibrary>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  storage.saveLibrary.mockResolvedValue(undefined);
  storage.pruneAssets.mockResolvedValue(undefined);
  storage.prunePictures.mockResolvedValue(undefined);
});
afterEach(async () => { if (screen) await act(async () => screen!.unmount()); screen = undefined; vi.unstubAllGlobals(); });

async function open(library = migrateDeviceSettings(starterLibrary())) {
  storage.loadLibrary.mockResolvedValue(library);
  function Harness() { store = useLibrary(); return null; }
  await act(async () => { screen = create(React.createElement(Harness)); });
}

function pendingWrite() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it('retains downloaded creation pictures on restart alongside saved board media', async () => {
  const id = 'a'.repeat(64);
  const illustration = { kind: 'generated' as const, assetId: id, style: 'color' as const, description: 'A cow', model: 'fixture' };
  const library: Library = { ...starterLibrary(), boardCreationDraft: {
    prompt: '', history: [{ prompt: 'Cow', reply: 'A cow board.' }], clarifying: false, picturePolicy: defaultPicturePolicy,
    draft: { boardId: null, baseRevision: null, proposal: { title: 'Cow', explanation: 'A cow board.', needsClarification: false, tiles: [{ existingId: null, label: 'Cow', speech: 'Cow', language: 'en-US', emoji: '🐄', color: 'sage' }] }, pictures: [{ index: 0, illustration }] },
  } };
  await open(library);
  expect(store.library?.boardCreationDraft?.draft?.pictures).toEqual([{ index: 0, illustration }]);
  expect(storage.prunePictures).toHaveBeenCalledWith(new Set([id]));
  expect(store.loadError).toBe('');
});

it('serializes optimistic snapshots and lets only the newest write settle the save status', async () => {
  await open();
  const first = pendingWrite(), second = pendingWrite();
  storage.saveLibrary.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  let failed!: Promise<unknown>, saved!: Promise<void>;
  await act(async () => {
    failed = store.change(current => ({ ...current, favoriteBoardIds: ['first'] })).catch(error => error);
    saved = store.change(current => ({ ...current, favoriteBoardIds: ['second'] }));
  });
  expect(store.library?.favoriteBoardIds).toEqual(['second']);
  expect(storage.saveLibrary).toHaveBeenCalledTimes(1);
  expect(storage.saveLibrary.mock.calls[0][0].favoriteBoardIds).toEqual(['first']);
  await act(async () => { first.reject(new Error('Storage full')); await failed; });
  expect(storage.saveLibrary.mock.calls[1][0].favoriteBoardIds).toEqual(['second']);
  expect(store.saving).toBe(true);
  expect(store.error).toBe('');
  expect(store.flush()).toBe(saved);
  await act(async () => { second.resolve(); await store.flush(); });
  expect(store.saving).toBe(false);
  expect(store.error).toBe('');
});

it('retries the latest optimistic state after a failed save without discarding visible edits', async () => {
  await open();
  storage.saveLibrary.mockRejectedValueOnce(new Error('Storage full'));
  await act(async () => {
    await expect(store.change(current => ({ ...current, favoriteBoardIds: ['cow'] }))).rejects.toThrow('Storage full');
  });
  expect(store.library?.favoriteBoardIds).toEqual(['cow']);
  expect(store.error).toContain('Changes are on screen');
  expect(store.saving).toBe(false);
  await act(async () => { await store.retry(); });
  expect(storage.saveLibrary).toHaveBeenLastCalledWith(store.library);
  expect(store.error).toBe('');
});

it('composes durable commits at execution time and publishes only successful saves', async () => {
  await open();
  const pending = pendingWrite();
  storage.saveLibrary.mockReturnValueOnce(pending.promise);
  let first!: Promise<void>, second!: Promise<void>;
  const append = (id: string) => (current: Library) => ({ ...current, favoriteBoardIds: [...(current.favoriteBoardIds ?? []), id] });
  await act(async () => { first = store.commit(append('first')); second = store.commit(append('second')); });
  expect(store.library?.favoriteBoardIds ?? []).toEqual([]);
  expect(storage.saveLibrary).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(); await first; await second; });
  expect(store.library?.favoriteBoardIds).toEqual(['first', 'second']);
  storage.saveLibrary.mockRejectedValueOnce(new Error('Storage full'));
  await act(async () => { await expect(store.commit(append('failed'), 'Try saving again.')).rejects.toThrow(); });
  expect(store.library?.favoriteBoardIds).toEqual(['first', 'second']);
  expect(store.error).toBe('Try saving again.');
});
