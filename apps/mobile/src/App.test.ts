/** @file Verifies account gating and cached play restoration while isolating unrelated speech and translation services. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newLibrary } from '@little-say/core';
import { starterLibrary } from '../../../tests/fixtures/library';
import App from './App';

const state = vi.hoisted(() => ({ OS: 'android', library: null as any, account: { ready: true, session: null as any, needsLogin: false }, audio: vi.fn(), commit: vi.fn(), back: null as null | (() => boolean) }));
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
vi.mock('./services/useAccountRoute', () => ({ useAccountRoute: () => ({ route: null, open: vi.fn(), close: vi.fn(), back: vi.fn() }) }));
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
  vi.stubGlobal('window', { speechSynthesis: undefined });
  state.account = { ready: true, session: null, needsLogin: false };
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
