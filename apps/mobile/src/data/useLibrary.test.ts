/** @file Verifies that initial library pruning preserves pictures belonging to explicitly saved creation drafts. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultPicturePolicy, type Library } from '@little-say/core';
import { starterLibrary } from '../../../../tests/fixtures/library';
import { useLibrary } from './useLibrary';

const storage = vi.hoisted(() => ({ loadLibrary: vi.fn(), saveLibrary: vi.fn(), pruneAssets: vi.fn(), prunePictures: vi.fn() }));
vi.mock('./storage', () => storage);
let screen: ReactTestRenderer | undefined;
afterEach(async () => { if (screen) await act(async () => screen!.unmount()); screen = undefined; vi.unstubAllGlobals(); });

it('retains downloaded creation pictures on restart alongside saved board media', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const id = 'a'.repeat(64);
  const illustration = { kind: 'generated' as const, assetId: id, style: 'color' as const, description: 'A cow', model: 'fixture' };
  const library: Library = { ...starterLibrary(), boardCreationDraft: {
    prompt: '', history: [{ prompt: 'Cow', reply: 'A cow board.' }], clarifying: false, picturePolicy: defaultPicturePolicy,
    draft: { boardId: null, baseRevision: null, proposal: { title: 'Cow', explanation: 'A cow board.', needsClarification: false, tiles: [{ existingId: null, label: 'Cow', speech: 'Cow', language: 'en-US', emoji: '🐄', color: 'sage' }] }, pictures: [{ index: 0, illustration }] },
  } };
  storage.loadLibrary.mockResolvedValue(library); storage.saveLibrary.mockResolvedValue(undefined);
  storage.pruneAssets.mockResolvedValue(undefined); storage.prunePictures.mockResolvedValue(undefined);
  let store!: ReturnType<typeof useLibrary>;
  function Harness() { store = useLibrary(); return null; }
  await act(async () => { screen = create(React.createElement(Harness)); });
  expect(store.library?.boardCreationDraft?.draft?.pictures).toEqual([{ index: 0, illustration }]);
  expect(storage.prunePictures).toHaveBeenCalledWith(new Set([id]));
  expect(store.loadError).toBe('');
});
