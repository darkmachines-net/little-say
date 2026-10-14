/** @file Verifies manual native OTA progress, persistence before reload, failure recovery, and cancellation. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUpdateSettings } from './AppUpdateSettings';
import { AppUpdateSettings as WebAppUpdateSettings } from './AppUpdateSettings.web';

const updates = vi.hoisted(() => ({ enabled: true, check: vi.fn(), fetch: vi.fn(), reload: vi.fn() }));
vi.mock('expo-updates', () => ({
  get isEnabled() { return updates.enabled; },
  checkForUpdateAsync: updates.check,
  fetchUpdateAsync: updates.fetch,
  reloadAsync: updates.reload,
}));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('lucide-react-native', () => ({ AlertCircle: 'AlertCircle' }));
// Shared UI also exports native dialogs; this OTA test does not exercise their window measurement.
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' }));

let renderer: ReactTestRenderer | undefined;
const save = vi.fn();
const button = () => renderer!.root.findByType(Pressable);
const text = () => renderer!.root.findAllByType(Text).map(node => node.children.join('')).join('\n');
async function mount(visible = true, onBeforeRestart = save) {
  await act(async () => { renderer = create(React.createElement(AppUpdateSettings, { visible, onBeforeRestart })); });
}
async function press() { await act(async () => { button().props.onPress(); }); }
async function unmount() { await act(async () => { renderer?.unmount(); renderer = undefined; }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('__DEV__', false);
  updates.enabled = true;
  updates.check.mockResolvedValue({ isAvailable: true, isRollBackToEmbedded: false });
  updates.fetch.mockResolvedValue({ isNew: true, isRollBackToEmbedded: false });
  updates.reload.mockResolvedValue(undefined);
  save.mockResolvedValue(undefined);
});
afterEach(async () => { await unmount(); vi.unstubAllGlobals(); });

describe('manual mobile app updates', () => {
  it('waits for a parent press, reports each stage, saves the latest draft, and reloads once', async () => {
    const checked = deferred<{ isAvailable: boolean }>();
    const downloaded = deferred<{ isNew: boolean }>();
    const saved = deferred<void>();
    const latestSave = vi.fn(() => saved.promise);
    updates.check.mockReturnValue(checked.promise);
    updates.fetch.mockReturnValue(downloaded.promise);
    await mount();
    expect(updates.check).not.toHaveBeenCalled();
    const pressTwice = button().props.onPress;
    await act(async () => { pressTwice(); pressTwice(); });
    expect(updates.check).toHaveBeenCalledOnce();
    expect(button().props.disabled).toBe(true);
    expect(text()).toContain('Checking for updates…');
    expect(updates.fetch).not.toHaveBeenCalled();
    await act(async () => { checked.resolve({ isAvailable: true }); });
    expect(text()).toContain('Downloading update…');
    expect(save).not.toHaveBeenCalled();
    await act(async () => { renderer!.update(React.createElement(AppUpdateSettings, { visible: true, onBeforeRestart: latestSave })); });
    await act(async () => { downloaded.resolve({ isNew: true }); });
    expect(text()).toContain('Saving settings…');
    expect(latestSave).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(updates.reload).not.toHaveBeenCalled();
    await act(async () => { saved.resolve(); });
    expect(updates.reload).toHaveBeenCalledOnce();
    expect(text()).toContain('Restarting to install…');
    expect(button().props.disabled).toBe(true);
  });

  it('reports an up-to-date app without saving or restarting', async () => {
    updates.check.mockResolvedValue({ isAvailable: false, isRollBackToEmbedded: false });
    await mount(); await press();
    expect(text()).toContain('Little Say is up to date.');
    expect(button().props.disabled).toBe(false);
    expect(updates.fetch).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(updates.reload).not.toHaveBeenCalled();
  });

  it('does not restart when the download finds no new update', async () => {
    updates.fetch.mockResolvedValue({ isNew: false, isRollBackToEmbedded: false });
    await mount(); await press();
    expect(text()).toContain('Little Say is up to date.');
    expect(save).not.toHaveBeenCalled();
    expect(updates.reload).not.toHaveBeenCalled();
  });

  it('installs a server-directed rollback to the embedded update', async () => {
    updates.check.mockResolvedValue({ isAvailable: false, isRollBackToEmbedded: true });
    updates.fetch.mockResolvedValue({ isNew: false, isRollBackToEmbedded: true });
    await mount(); await press();
    expect(updates.fetch).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(updates.reload).toHaveBeenCalledOnce();
  });

  it.each(['check', 'fetch', 'save', 'reload'] as const)('recovers from a %s failure and allows retry', async stage => {
    const action = stage === 'save' ? save : updates[stage];
    action.mockRejectedValueOnce(new Error('Failure'));
    await mount(); await press();
    const messages = { check: 'Could not check for updates.', fetch: 'Could not download the update.', save: 'your settings could not be saved.', reload: 'the app could not restart.' };
    expect(text()).toContain(messages[stage]);
    expect(button().props.disabled).toBe(false);
    expect(updates.reload).toHaveBeenCalledTimes(stage === 'reload' ? 1 : 0);
    await press();
    expect(text()).not.toContain(messages[stage]);
    expect(updates.reload).toHaveBeenCalledTimes(stage === 'reload' ? 2 : 1);
  });

  it.each(['development', 'disabled'] as const)('disables checks in %s builds', async mode => {
    if (mode === 'development') vi.stubGlobal('__DEV__', true);
    else updates.enabled = false;
    await mount();
    expect(button().props.disabled).toBe(true);
    expect(text()).toContain('Update checks are unavailable in this build.');
    await press();
    expect(updates.check).not.toHaveBeenCalled();
  });

  it.each(['check', 'fetch', 'save'] as const)('does not restart after unmounting during %s', async stage => {
    const pending = deferred<unknown>();
    (stage === 'save' ? save : updates[stage]).mockReturnValue(pending.promise);
    await mount(); await press(); await unmount();
    await act(async () => { pending.resolve({ isAvailable: true, isNew: true }); });
    expect(updates.reload).not.toHaveBeenCalled();
    if (stage !== 'save') expect(save).not.toHaveBeenCalled();
    if (stage === 'check') expect(updates.fetch).not.toHaveBeenCalled();
  });

  it('abandons a hidden settings flow and permits a fresh check after reopening', async () => {
    const pending = deferred<{ isNew: boolean }>();
    updates.fetch.mockReturnValueOnce(pending.promise);
    await mount(); await press();
    await act(async () => { renderer!.update(React.createElement(AppUpdateSettings, { visible: false, onBeforeRestart: save })); });
    await press();
    expect(updates.check).toHaveBeenCalledOnce();
    await act(async () => { renderer!.update(React.createElement(AppUpdateSettings, { visible: true, onBeforeRestart: save })); });
    expect(button().props.disabled).toBe(false);
    await act(async () => { pending.resolve({ isNew: true }); });
    expect(save).not.toHaveBeenCalled();
    expect(updates.reload).not.toHaveBeenCalled();
    await press();
    expect(updates.reload).toHaveBeenCalledOnce();
  });

  it('renders no OTA control on web', async () => {
    await act(async () => { renderer = create(React.createElement(WebAppUpdateSettings, { visible: true, onBeforeRestart: save })); });
    expect(renderer!.toJSON()).toBeNull();
    expect(updates.check).not.toHaveBeenCalled();
  });
});
