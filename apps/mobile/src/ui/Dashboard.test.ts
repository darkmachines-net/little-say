/** @file Verifies centered first restoration, connection/failure recovery, and usable cached boards during background sync. */
import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { starterLibrary } from '../../../../tests/fixtures/library';
import { Dashboard } from './Dashboard';

vi.mock('react-native', () => ({ View: 'View', Text: 'Text', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', useWindowDimensions: () => ({ width: 390 }), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('lucide-react-native', () => ({ Plus: 'Plus', UserRound: 'UserRound', Settings: 'Settings' }));
vi.mock('./AppHeader', () => ({ AppHeader: 'AppHeader' }));
vi.mock('./Brand', () => ({ MountainMark: 'MountainMark' }));
vi.mock('./BoardCard', () => ({ BoardCard: 'BoardCard' }));
vi.mock('./BoardMenu', () => ({ BoardMenu: 'BoardMenu' }));
vi.mock('./components', () => ({ Button: 'Button', Notice: 'Notice' }));

let screen: ReactTestRenderer | undefined;
const retrySync = vi.fn(async () => {}), onPlay = vi.fn(), onCompose = vi.fn();
function nodes(name: string) { return screen!.root.findAllByType(name as any); }
async function render(restoring: boolean, syncing = false, error = '', empty = true, offline = false) {
  const library = starterLibrary(); if (empty) library.boards = [];
  const props = { library, audio: {} as React.ComponentProps<typeof Dashboard>['audio'], sync: { restoring, syncing, backup: { error, state: offline ? 'offline' as const : 'synced' as const }, retrySync }, onPlay, onCompose, onOpen: vi.fn(), onSettings: vi.fn(), onAccount: vi.fn(), accountLabel: 'Account & backup', onDelete: vi.fn(), onFavorite: vi.fn(), saving: false };
  await act(async () => { if (screen) screen.update(React.createElement(Dashboard, props)); else screen = create(React.createElement(Dashboard, props)); });
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); });
afterEach(async () => { if (screen) await act(async () => screen!.unmount()); screen = undefined; vi.unstubAllGlobals(); });

it('shows progress before the first request starts and avoids an empty library or creation until restoration completes', async () => {
  await render(true);
  expect(nodes('ActivityIndicator')).toHaveLength(1);
  expect(nodes('Text').map(node => node.props.children)).toContain('Syncing your content…');
  expect(nodes('Text').map(node => node.props.children)).not.toContain('No boards yet');
  expect(nodes('Button').find(node => node.props.children === 'New board')).toBeUndefined();
  expect(nodes('Text').map(node => node.props.children)).not.toContain('Your soundboards');
  await render(false);
  expect(nodes('ActivityIndicator')).toHaveLength(0);
  expect(nodes('Text').map(node => node.props.children)).toContain('No boards yet');
  expect(nodes('Button').find(node => node.props.children === 'New board')).toBeDefined();
});

it('offers first-restore retry on Home and replaces failure with progress on retry', async () => {
  await render(true, false, 'Offline');
  expect(nodes('ActivityIndicator')).toHaveLength(0);
  expect(nodes('Notice')[0].props.children).toContain('Offline');
  expect(nodes('Text').map(node => node.props.children)).not.toContain('No boards yet');
  await act(async () => nodes('Notice')[0].props.action.props.onPress());
  expect(retrySync).toHaveBeenCalledOnce();
  await render(true, true);
  expect(nodes('Notice')).toHaveLength(0); expect(nodes('ActivityIndicator')).toHaveLength(1);
});

it('keeps cached boards and creation usable during background sync, then removes progress', async () => {
  await render(false, true, '', false);
  expect(nodes('ActivityIndicator')).toHaveLength(1);
  await act(async () => nodes('BoardCard')[0].props.onPlay()); expect(onPlay).toHaveBeenCalledOnce();
  const createButton = nodes('Button').find(node => node.props.children === 'New board')!;
  expect(createButton.props.disabled).toBeFalsy();
  await act(async () => createButton.props.onPress()); expect(onCompose).toHaveBeenCalledOnce();
  await render(false, false, '', false);
  expect(nodes('ActivityIndicator')).toHaveLength(0); expect(nodes('BoardCard').length).toBeGreaterThan(0);
});

it('explains connection loss instead of spinning while an empty device is offline', async () => {
  await render(true, false, '', true, true);
  expect(nodes('ActivityIndicator')).toHaveLength(0);
  expect(nodes('Notice')[0].props.children).toContain('Waiting for a connection');
  await render(true, true);
  expect(nodes('Notice')).toHaveLength(0); expect(nodes('ActivityIndicator')).toHaveLength(1);
});
