/** @file Verifies deferred translation saves, request deduplication, cancellation, navigation lifetime, and stale-edit protection. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { tileSource, type Library, type TranslationEnvelope, type TranslationRequest } from '@little-say/core';
import { starterLibrary } from '../../../../tests/fixtures/library';
import { useBoardTranslations } from './useBoardTranslations';
import { prepareTranslations } from './api';

vi.mock('./api', () => ({ prepareTranslations: vi.fn() }));
let screen: ReactTestRenderer | undefined;
afterEach(async () => { if (screen) await act(async () => screen!.unmount()); screen = undefined; vi.resetAllMocks(); vi.unstubAllGlobals(); });

function response(request: TranslationRequest): TranslationEnvelope {
  return { boardId: request.boardId, baseRevision: request.baseRevision, translations: request.tiles.flatMap(tile => tile.targets.map(language => ({ tileId: tile.id, language, label: 'Vaca', speech: 'vaca', source: '', origin: 'generated' as const }))) };
}

async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const library = starterLibrary({ languages: ['en-US', 'ru-RU', 'es-ES'], defaultLanguage: 'en-US' });
  library.settings.aiConsent = true;
  const board = library.boards[0];
  board.tiles[0].languageMode = 'board';
  board.tiles[0].translations = [{ language: 'ru-RU', label: 'Корова', speech: 'Saved correction', source: tileSource(board.tiles[0]), origin: 'manual' }];
  const current = { current: library as Library | null };
  const store = {
    current,
    /** Apply the optimistic update immediately, modeling the store's serialized-save boundary. */
    change: vi.fn((update: (library: Library) => Library) => { current.current = update(current.current!); return Promise.resolve(); }),
    /** Model successful completion of all earlier selection saves. */
    flush: vi.fn(() => Promise.resolve()),
  };
  const onApplied = vi.fn();
  let controller!: ReturnType<typeof useBoardTranslations>;
  function Harness() { controller = useBoardTranslations(store, onApplied); return null; }
  await act(async () => { screen = create(React.createElement(Harness)); });
  return { store, onApplied, board, get controller() { return controller; } };
}

it('waits for selection saves, coalesces repeated closes, preserves fixed cards/corrections and prepares only once', async () => {
  const harness = await mount();
  harness.store.current.current!.settings.aiConsent = false;
  let release!: () => void;
  harness.store.flush.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
  vi.mocked(prepareTranslations).mockImplementation(async (_url, request) => {
    expect(harness.store.current.current!.settings.aiConsent).toBe(true);
    expect(request.tiles).toHaveLength(1);
    expect(request.tiles[0].targets).toEqual(['es-ES']);
    return response(request);
  });
  let pending!: Promise<void>;
  await act(async () => { pending = harness.controller.prepare(harness.board.id); });
  expect(prepareTranslations).not.toHaveBeenCalled();
  await act(async () => { await harness.controller.prepare(harness.board.id); release(); await pending; });
  expect(prepareTranslations).toHaveBeenCalledTimes(1);
  const saved = harness.store.current.current!.boards[0];
  expect(saved.tiles[0].translations?.map(value => value.speech)).toEqual(['Saved correction', 'vaca']);
  expect(saved.tiles[1]).toEqual(harness.board.tiles[1]);
  expect(harness.onApplied).toHaveBeenCalledWith(harness.board);
  await act(async () => { await harness.controller.prepare(harness.board.id); });
  expect(prepareTranslations).toHaveBeenCalledTimes(1);
});

it.each(['source edit', 'user languages', 'deletion'])('refuses a late result after %s without replacing newer data', async reason => {
  const harness = await mount();
  let release!: (value: TranslationEnvelope) => void;
  vi.mocked(prepareTranslations).mockReturnValue(new Promise(resolve => { release = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = harness.controller.prepare(harness.board.id); });
  const request = vi.mocked(prepareTranslations).mock.calls[0][1];
  const current = harness.store.current.current!;
  if (reason === 'source edit') current.boards[0] = { ...current.boards[0], revision: 1, tiles: current.boards[0].tiles.map(tile => ({ ...tile, speech: 'Newer words' })) };
  else if (reason === 'user languages') current.settings.languageProfile = { languages: ['en-US'], defaultLanguage: 'en-US' };
  else current.boards = [];
  const expected = structuredClone(current);
  await act(async () => { release(response(request)); await pending; });
  expect(harness.store.current.current).toEqual(expected);
  expect(harness.controller.status[harness.board.id].error).toContain('changed while translating');
  expect(harness.onApplied).not.toHaveBeenCalled();
});

it('ignores cancelled results, exposes failures, and retries against the latest board', async () => {
  const harness = await mount();
  let release!: (value: TranslationEnvelope) => void;
  vi.mocked(prepareTranslations).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = harness.controller.prepare(harness.board.id); });
  const request = vi.mocked(prepareTranslations).mock.calls[0][1];
  await act(async () => harness.controller.cancel(harness.board.id));
  expect(vi.mocked(prepareTranslations).mock.calls[0][2]?.aborted).toBe(true);
  await act(async () => { release(response(request)); await pending; });
  expect(harness.store.current.current!.boards[0]).toEqual(harness.board);
  vi.mocked(prepareTranslations).mockRejectedValueOnce(new Error('Offline'));
  await act(async () => { await harness.controller.prepare(harness.board.id); });
  expect(harness.controller.status[harness.board.id]).toEqual({ busy: false, error: 'Offline' });
  vi.mocked(prepareTranslations).mockImplementation(async (_url, request) => response(request));
  await act(async () => { await harness.controller.prepare(harness.board.id); });
  expect(harness.controller.status[harness.board.id]).toEqual({ busy: false });
  expect(harness.store.current.current!.boards[0].tiles[0].translations).toHaveLength(2);
});

it('does not request translations when a language-selection save failed', async () => {
  const harness = await mount();
  harness.store.flush.mockRejectedValue(new Error('Storage full'));
  await act(async () => { await harness.controller.prepare(harness.board.id); });
  expect(prepareTranslations).not.toHaveBeenCalled();
  expect(harness.controller.status[harness.board.id].error).toBe('Storage full');
});

it('aborts requests on app unmount and never applies their late results', async () => {
  const harness = await mount();
  let release!: (value: TranslationEnvelope) => void;
  vi.mocked(prepareTranslations).mockReturnValue(new Promise(resolve => { release = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = harness.controller.prepare(harness.board.id); });
  const request = vi.mocked(prepareTranslations).mock.calls[0][1];
  await act(async () => { screen!.unmount(); screen = undefined; });
  release(response(request)); await pending;
  expect(vi.mocked(prepareTranslations).mock.calls[0][2]?.aborted).toBe(true);
  expect(harness.store.change).not.toHaveBeenCalled();
});
