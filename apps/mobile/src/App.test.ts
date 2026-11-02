/** @file Verifies sign-in and Home restoration, unified Settings routes, cached play, and shared Undo/Redo across edits, AI, translations, drafts, and navigation. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { boardWithProfileLanguages, newLibrary, type Board, type Library } from '@little-say/core';
import { starterLibrary } from '../../../tests/fixtures/library';
import App from './App';

const state = vi.hoisted(() => ({ OS: 'android', library: null as any, account: { ready: true, session: null as any, needsLogin: false, restoring: false, syncing: false, backup: { error: '' } }, audio: vi.fn(), commit: vi.fn(), change: vi.fn(), route: null as { boardId: string | null } | null, translated: null as null | ((board: Board) => void) }));
vi.mock('react-native', () => ({ Platform: state, View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (value: unknown) => value }, AppState: { addEventListener: () => ({ remove() {} }) }, BackHandler: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView', initialWindowMetrics: null }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'new-board' }));
vi.mock('./data/useLibrary', () => ({ useLibrary: () => ({ library: state.library, current: { get current() { return state.library; } }, commit: state.commit, change: state.change, flush: async () => {} }) }));
vi.mock('./services/useAccount', () => ({ useAccount: () => state.account }));
vi.mock('./services/useSpeechLibrary', () => ({ useSpeechLibrary: (library: unknown) => { state.audio(library); return {}; } }));
vi.mock('./services/useBoardTranslations', () => ({ useBoardTranslations: (_store: unknown, applied: (board: Board) => void) => { state.translated = applied; return { status: {}, prepare: vi.fn(), cancel: vi.fn() }; } }));
vi.mock('./services/speech', () => ({ getVoices: async () => [], speechQueue: () => ({ stop() {} }) }));
vi.mock('./services/updates', () => ({ initializeUpdates: async () => () => {}, applyUpdate: vi.fn() }));
vi.mock('./ui/AccountScreen', () => ({ AccountScreen: 'AccountScreen' }));
vi.mock('./ui/Brand', () => ({ Brand: 'Brand' }));
vi.mock('./services/useBoardDraftRoute', () => ({ useBoardDraftRoute: () => ({ route: state.route,
  open: (boardId: string | null) => { state.route = { boardId }; },
  replace: (boardId: string | null) => { state.route = { boardId }; },
  close: () => { state.route = null; }, save: (operation: () => Promise<void>) => operation(),
}) }));
vi.mock('./ui/Dashboard', () => ({ Dashboard: 'Dashboard' }));
vi.mock('./ui/FirstTimeSetup', () => ({ FirstTimeSetup: 'FirstTimeSetup' }));
vi.mock('./ui/SettingsScreen', () => ({ SettingsScreen: 'SettingsScreen' }));
vi.mock('./ui/BoardEditor', () => ({ BoardEditor: 'BoardEditor' }));
vi.mock('./ui/PlayBoard', () => ({ PlayBoard: 'PlayBoard' }));
vi.mock('./ui/components', () => ({ Button: 'Button', Notice: 'Notice', Sheet: 'Sheet' }));

let screen: ReactTestRenderer | undefined;
async function render() { await act(async () => { if (screen) screen.update(React.createElement(App)); else screen = create(React.createElement(App)); }); }
function nodes(name: string) { return screen!.root.findAllByType(name as any); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  state.library = starterLibrary(); state.library.settings.accountChoiceMade = true; state.OS = 'android';
  vi.stubGlobal('window', { speechSynthesis: undefined, location: { pathname: '/app' }, history: { replaceState: vi.fn(), pushState: vi.fn() }, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() });
  state.account = { ready: true, session: null, needsLogin: false, restoring: false, syncing: false, backup: { error: '' } };
  state.route = null; state.translated = null;
  state.change.mockReset().mockImplementation(async (update: (library: Library) => Library) => { state.library = update(state.library); });
  state.commit.mockReset().mockImplementation(async (update: (library: Library) => Library) => { state.library = update(state.library); });
});
afterEach(async () => { if (screen) await act(async () => screen!.unmount()); screen = undefined; vi.unstubAllGlobals(); });

it.each(['android', 'ios', 'web'])('blocks former guests on %s even with an active board and starts no automatic speech work', async platform => {
  state.OS = platform;
  state.library.settings.activeBoardId = state.library.boards[0].id;
  await render();
  expect(nodes('AccountScreen')).toHaveLength(1); expect(nodes('PlayBoard')).toHaveLength(0);
  expect(state.audio).toHaveBeenLastCalledWith(null);
  expect(nodes('AccountScreen')[0].props.onClose).toBeUndefined();
  expect(nodes('AccountScreen')).toHaveLength(1); expect(state.commit).not.toHaveBeenCalled();
  state.account.session = { account: { id: 'family' } }; await render();
  expect(nodes('PlayBoard')).toHaveLength(1);
});

it('keeps a persisted sign-in usable offline and returns to welcome after sign-out or expiry', async () => {
  const boards = structuredClone(state.library.boards);
  state.account.session = { account: { id: 'family' } }; await render();
  expect(nodes('Dashboard')).toHaveLength(1); expect(nodes('AccountScreen')).toHaveLength(0);
  state.account.needsLogin = true; await render();
  expect(nodes('AccountScreen')).toHaveLength(1); expect(nodes('Dashboard')).toHaveLength(0);
  state.account.needsLogin = false; state.account.session = null; await render();
  expect(nodes('AccountScreen')).toHaveLength(1);
  expect(state.library.boards).toEqual(boards);
});

it('waits for session restoration before showing entry or preparing speech', async () => {
  state.account.ready = false; await render();
  expect(nodes('AccountScreen')).toHaveLength(0); expect(nodes('Dashboard')).toHaveLength(0);
  expect(state.audio).toHaveBeenLastCalledWith(null);
  state.account.ready = true; await render();
  expect(nodes('AccountScreen')).toHaveLength(1);
});

it('requires an account before setup and opens Settings from its header', async () => {
  state.library = newLibrary('en-US'); await render();
  expect(nodes('FirstTimeSetup')).toHaveLength(0);
  state.account.session = { account: { id: 'family' } }; await render();
  await act(async () => nodes('FirstTimeSetup')[0].props.onSettings());
  expect(nodes('SettingsScreen')[0].props.returnLabel).toBe('Back to setup');
});

const editor = () => nodes('BoardEditor')[0].props;
async function editBoard(id: string | null = state.library.boards[0].id) {
  state.account.session = { account: { id: 'family' } }; state.route = { boardId: id }; await render();
}
async function action(name: 'onUndo' | 'onRedo') { await act(async () => editor()[name]()); }
async function rename(title: string) { await act(async () => editor().onChange({ title })); }
function content(board: Board) { const { revision: _revision, updatedAt: _updatedAt, ...value } = board; return value; }

it('round-trips manual and AI changes in order with fresh revisions and unchanged recency', async () => {
  await editBoard();
  const original = state.library.boards[0] as Board;
  const recency = structuredClone(state.library.boardLastPlayedAt);
  expect(editor().canUndo).toBe(false); expect(editor().canRedo).toBe(false);
  await rename('Manual title');
  const manual = state.library.boards[0] as Board;
  await act(async () => editor().onAccept({ base: manual, board: { ...manual, title: 'AI title', tiles: manual.tiles.slice(1).reverse() } }));
  const generated = state.library.boards[0] as Board;
  let revision = generated.revision;
  for (const [operation, expected] of [['onUndo', manual], ['onUndo', original], ['onRedo', manual], ['onRedo', generated], ['onUndo', manual], ['onRedo', generated]] as const) {
    await action(operation);
    expect(content(editor().board)).toEqual(content(boardWithProfileLanguages(expected, state.library.settings)));
    expect(editor().board.revision).toBe(++revision);
    expect(editor().board.updatedAt).toMatch(/^\d{4}-/);
    expect(content(state.library.boards[0])).toEqual(content(expected));
  }
  expect(editor().canRedo).toBe(false);
  await action('onRedo'); expect(editor().board.revision).toBe(revision);
  expect(state.library.boardLastPlayedAt).toEqual(recency);
});

it.each(['manual', 'AI', 'translation'])('discards remaining redo after a new %s change from a partially restored point', async kind => {
  await editBoard(); await rename('First'); await rename('Second'); await rename('Third');
  await action('onUndo'); await action('onUndo'); await action('onRedo');
  expect(editor().board.title).toBe('Second'); expect(editor().canRedo).toBe(true);
  const base = editor().board as Board;
  if (kind === 'manual') await rename('New branch');
  if (kind === 'AI') await act(async () => editor().onAccept({ base, board: { ...base, title: 'New branch' } }));
  if (kind === 'translation') await act(async () => {
    await state.change((library: Library) => ({ ...library, boards: library.boards.map(board => board.id === base.id ? { ...board, title: 'New branch', revision: board.revision + 1 } : board) }));
    state.translated!(base);
  });
  expect(editor().canRedo).toBe(false); await action('onRedo');
  expect(editor().board.title).toBe('New branch');
  await action('onUndo'); expect(editor().board.title).toBe('Second');
  await action('onRedo'); expect(editor().board.title).toBe('New branch'); expect(editor().canRedo).toBe(false);
});

it('keeps redo after rejected edits and failed AI saves, and retains optimistic history after a write failure', async () => {
  await editBoard(); await rename('First'); await action('onUndo');
  expect(() => editor().onChange({ title: 'Stale' }, -1)).toThrow('changed while editing');
  expect(() => editor().onChange({ title: '' })).toThrow();
  const base = editor().board;
  state.commit.mockRejectedValueOnce(new Error('Storage full'));
  await act(async () => { await expect(editor().onAccept({ base, board: { ...base, title: 'Failed' } })).rejects.toThrow('Storage full'); });
  expect(editor().canRedo).toBe(true);
  state.change.mockImplementationOnce(async (update: (library: Library) => Library) => { state.library = update(state.library); throw new Error('Storage full'); });
  await action('onRedo'); expect(editor().board.title).toBe('First');
  await action('onUndo'); expect(content(editor().board)).toEqual(content(base));
  await action('onRedo'); expect(editor().board.title).toBe('First');
});

it.each(['manual', 'AI'])('restores a newly created %s board after undo returns to an empty draft', async kind => {
  const count = state.library.boards.length;
  await editBoard(null);
  const base = editor().board as Board;
  const tiles = state.library.boards[0].tiles;
  await act(async () => {
    if (kind === 'manual') editor().onChange({ tiles });
    else await editor().onAccept({ base, board: { ...base, title: 'Created by AI', tiles } });
  });
  const created = editor().board as Board;
  const recency = structuredClone(state.library.boardLastPlayedAt);
  for (let cycle = 0; cycle < 2; cycle++) {
    await action('onUndo');
    expect(editor().board.tiles).toEqual([]); expect(editor().draft).toBeDefined();
    expect(state.library.boards).toHaveLength(count); expect(state.route?.boardId).toBeNull();
    expect(editor().canRedo).toBe(true);
    await action('onRedo');
    expect(content(editor().board)).toEqual(content(created)); expect(editor().draft).toBeUndefined();
    expect(state.library.boards).toHaveLength(count + 1); expect(state.route?.boardId).toBe(created.id);
    expect(state.library.boardLastPlayedAt).toEqual(recency);
  }
});

it('retains independent histories across navigation and clears history on deletion', async () => {
  const [first, second] = state.library.boards as Board[];
  await editBoard(first.id); await rename('First edited'); await action('onUndo');
  await editBoard(second.id); expect(editor().canUndo).toBe(false); expect(editor().canRedo).toBe(false);
  await rename('Second edited'); await action('onUndo');
  await editBoard(first.id); await action('onRedo'); expect(editor().board.title).toBe('First edited');
  await rename('First branch');
  await editBoard(second.id); expect(editor().canRedo).toBe(true); await action('onRedo'); expect(editor().board.title).toBe('Second edited');
  await act(async () => editor().onDelete());
  state.library.boards.push(second); await editBoard(second.id);
  expect(editor().canUndo).toBe(false); expect(editor().canRedo).toBe(false);
});

it('bounds history at 20 edits and keeps rapid traversal ordered before a render', async () => {
  await editBoard();
  for (let index = 1; index <= 25; index++) await rename(`Title ${index}`);
  const undo = editor().onUndo;
  await act(async () => { for (let index = 0; index < 21; index++) undo(); });
  expect(editor().board.title).toBe('Title 5'); expect(editor().canUndo).toBe(false);
  const redo = editor().onRedo;
  await act(async () => { for (let index = 0; index < 21; index++) redo(); });
  expect(editor().board.title).toBe('Title 25'); expect(editor().canRedo).toBe(false);
});

it.each(['android', 'ios', 'web'])('leaves account entry on %s immediately after sign-in and restores content on Home', async platform => {
  state.OS = platform; state.library = newLibrary('en-US');
  await render();
  await act(async () => nodes('AccountScreen')[0].props.onMode('login'));
  state.account.session = { account: { id: 'family' } }; state.account.restoring = true;
  await render();
  expect(nodes('AccountScreen')).toHaveLength(0);
  expect(nodes('FirstTimeSetup')).toHaveLength(0);
  expect(nodes('Dashboard')[0].props.sync.restoring).toBe(true);
  if (platform === 'web') expect(window.history.replaceState).toHaveBeenLastCalledWith(null, '', '/app');
  state.account.backup.error = 'Offline'; await render();
  expect(nodes('Dashboard')[0].props.sync.backup.error).toBe('Offline');
  expect(nodes('AccountScreen')).toHaveLength(0);
  state.library = starterLibrary(); state.account.restoring = false; state.account.backup.error = ''; await render();
  expect(nodes('Dashboard')[0].props.library.boards.length).toBeGreaterThan(0);
  expect(nodes('FirstTimeSetup')).toHaveLength(0);
});

it.each([null, 'register'] as const)('closes %s entry after authentication but keeps explicitly opened account settings available during sync', async mode => {
  await render();
  await act(async () => nodes('AccountScreen')[0].props.onMode(mode));
  state.account.session = { account: { id: 'family' } }; state.account.syncing = true; await render();
  expect(nodes('AccountScreen')).toHaveLength(0);
  await act(async () => nodes('Dashboard')[0].props.onSettings());
  expect(nodes('SettingsScreen')).toHaveLength(1);
  await act(async () => nodes('SettingsScreen')[0].props.onBack());
  expect(nodes('SettingsScreen')).toHaveLength(0);
});

it('restores an existing session on Home and opens setup only after confirming the cloud library is empty', async () => {
  state.library = newLibrary('en-US'); state.account.session = { account: { id: 'family' } }; state.account.restoring = true;
  await render();
  expect(nodes('Dashboard')).toHaveLength(1); expect(nodes('AccountScreen')).toHaveLength(0);
  expect(nodes('FirstTimeSetup')).toHaveLength(0);
  state.account.restoring = false; await render();
  expect(nodes('FirstTimeSetup')).toHaveLength(1); expect(nodes('Dashboard')).toHaveLength(0);
});

it('returns Home after signing back in from a Settings confirmation page', async () => {
  state.account.session = { account: { id: 'family' } }; await render();
  await act(async () => nodes('Dashboard')[0].props.onSettings());
  await act(async () => nodes('SettingsScreen')[0].props.onNavigate({ page: 'account', mode: 'sign-out' }));
  state.account.session = null; await render();
  expect(nodes('AccountScreen')).toHaveLength(1);
  state.account.session = { account: { id: 'family' } }; await render();
  expect(nodes('SettingsScreen')).toHaveLength(0);
  expect(nodes('Dashboard')).toHaveLength(1);
});

it.each(['android', 'ios', 'web'])('keeps explicitly opened account child pages available on %s during restoration', async platform => {
  state.OS = platform; state.library = newLibrary('en-US');
  state.account.session = { account: { id: 'family' } }; state.account.restoring = true;
  await render();
  await act(async () => nodes('Dashboard')[0].props.onSettings());
  await act(async () => nodes('SettingsScreen')[0].props.onNavigate({ page: 'account', mode: 'backup' }));
  expect(nodes('SettingsScreen')[0].props.route.mode).toBe('backup');
  await act(async () => nodes('SettingsScreen')[0].props.onNavigate({ page: 'account', mode: 'verify-email' }));
  expect(nodes('SettingsScreen')[0].props.route.mode).toBe('verify-email');
  if (platform !== 'web') {
    await act(async () => nodes('SettingsScreen')[0].props.onBack());
    expect(nodes('SettingsScreen')[0].props.route.mode).toBe('backup');
  }
});
