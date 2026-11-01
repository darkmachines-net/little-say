/** @file Verifies required sign-in, immediate Home restoration, retained account management routes, and cached play while isolating speech. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newLibrary } from '@little-say/core';
import { starterLibrary } from '../../../tests/fixtures/library';
import App from './App';

const state = vi.hoisted(() => ({ OS: 'android', library: null as any, account: { ready: true, session: null as any, needsLogin: false, restoring: false, syncing: false, backup: { error: '' } }, audio: vi.fn(), commit: vi.fn(), back: null as null | (() => boolean) }));
vi.mock('react-native', () => ({ Platform: state, View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (value: unknown) => value }, AppState: { addEventListener: () => ({ remove() {} }) }, BackHandler: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView', initialWindowMetrics: null }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('expo-crypto', () => ({}));
vi.mock('./data/useLibrary', () => ({ useLibrary: () => ({ library: state.library, current: { current: state.library }, commit: state.commit }) }));
vi.mock('./services/useAccount', () => ({ useAccount: () => state.account }));
vi.mock('./services/useSpeechLibrary', () => ({ useSpeechLibrary: (library: unknown) => { state.audio(library); return {}; } }));
vi.mock('./services/useBoardTranslations', () => ({ useBoardTranslations: () => ({ status: {}, prepare: vi.fn(), cancel: vi.fn() }) }));
vi.mock('./services/speech', () => ({ getVoices: async () => [], speechQueue: () => ({ stop() {} }) }));
vi.mock('./services/updates', () => ({ initializeUpdates: async () => () => {}, applyUpdate: vi.fn() }));
vi.mock('./ui/AccountScreen', () => ({ AccountScreen: 'AccountScreen' }));
vi.mock('./ui/Brand', () => ({ Brand: 'Brand' }));
vi.mock('./services/useSettingsRoute', () => ({ useSettingsRoute: () => ({ route: null }) }));
vi.mock('./services/useBoardDraftRoute', () => ({ useBoardDraftRoute: () => ({ route: null }) }));
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
});
afterEach(async () => { if (screen) await act(async () => screen!.unmount()); screen = undefined; vi.unstubAllGlobals(); });

it.each(['android', 'ios', 'web'])('blocks former guests on %s even with an active board and starts no automatic speech work', async platform => {
  state.OS = platform;
  state.library.settings.activeBoardId = state.library.boards[0].id;
  await render();
  expect(nodes('AccountScreen')).toHaveLength(1); expect(nodes('PlayBoard')).toHaveLength(0);
  expect(state.audio).toHaveBeenLastCalledWith(null);
  await act(async () => nodes('AccountScreen')[0].props.onClose());
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

it('requires an account before first-time setup and reflects sign-in in its header', async () => {
  state.library = newLibrary('en-US'); await render();
  expect(nodes('FirstTimeSetup')).toHaveLength(0);
  state.account.session = { account: { id: 'family' } }; await render();
  expect(nodes('FirstTimeSetup')[0].props.accountLabel).toBe('Account & backup');
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
  await act(async () => nodes('Dashboard')[0].props.onAccount());
  expect(nodes('AccountScreen')).toHaveLength(1);
  await act(async () => nodes('AccountScreen')[0].props.onClose());
  expect(nodes('AccountScreen')).toHaveLength(0);
});

it('restores an existing session on Home and opens setup only after confirming the cloud library is empty', async () => {
  state.library = newLibrary('en-US'); state.account.session = { account: { id: 'family' } }; state.account.restoring = true;
  await render();
  expect(nodes('Dashboard')).toHaveLength(1); expect(nodes('AccountScreen')).toHaveLength(0);
  expect(nodes('FirstTimeSetup')).toHaveLength(0);
  state.account.restoring = false; await render();
  expect(nodes('FirstTimeSetup')).toHaveLength(1); expect(nodes('Dashboard')).toHaveLength(0);
});

it.each(['android', 'ios', 'web'])('keeps explicitly opened account child pages available on %s during restoration', async platform => {
  state.OS = platform; state.library = newLibrary('en-US');
  state.account.session = { account: { id: 'family' } }; state.account.restoring = true;
  await render();
  await act(async () => nodes('Dashboard')[0].props.onAccount());
  await act(async () => nodes('AccountScreen')[0].props.onMode('backup'));
  expect(nodes('AccountScreen')[0].props.mode).toBe('backup');
  await act(async () => nodes('AccountScreen')[0].props.onMode('verify-email'));
  expect(nodes('AccountScreen')[0].props.mode).toBe('verify-email');
  if (platform !== 'web') {
    await act(async () => nodes('AccountScreen')[0].props.onBack());
    expect(nodes('AccountScreen')[0].props.mode).toBe('backup');
  }
});
