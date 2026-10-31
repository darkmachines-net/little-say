/** @file Verifies Android Settings Back navigation and protection while language preferences are saved. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useSettingsRoute } from './useSettingsRoute';

const native = vi.hoisted(() => ({ back: null as null | (() => boolean) }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, BackHandler: { addEventListener: (_event: string, callback: () => boolean) => { native.back = callback; return { remove: () => { native.back = null; } }; } } }));
let screen: ReactTestRenderer | undefined;
afterEach(async () => { if (screen) await act(async () => screen!.unmount()); screen = undefined; vi.unstubAllGlobals(); });

it('returns from Privacy to Settings to the caller using Android Back', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let navigation!: ReturnType<typeof useSettingsRoute>;
  function Harness() { navigation = useSettingsRoute(); return null; }
  await act(async () => { screen = create(React.createElement(Harness)); });
  await act(async () => navigation.open());
  await act(async () => navigation.open({ page: 'privacy' }));
  await act(async () => { expect(native.back?.()).toBe(true); });
  expect(navigation.route).toEqual({ page: 'overview' });
  await act(async () => { native.back?.(); });
  expect(navigation.route).toBeNull(); expect(native.back).toBeNull();
});

it('blocks Back and new pages until a pending save settles, including failure', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let navigation!: ReturnType<typeof useSettingsRoute>;
  function Harness() { navigation = useSettingsRoute(); return null; }
  await act(async () => { screen = create(React.createElement(Harness)); });
  await act(async () => navigation.open({ page: 'languages' }));
  let fail!: (error: Error) => void;
  const write = new Promise<void>((_resolve, reject) => { fail = reject; });
  const pending = navigation.save(() => write).catch(() => {});
  await act(async () => { native.back?.(); navigation.open({ page: 'about' }); });
  expect(navigation.route).toEqual({ page: 'languages' });
  await act(async () => { fail(new Error('Storage full')); await pending; });
  await act(async () => { native.back?.(); });
  expect(navigation.route).toEqual({ page: 'overview' });
  await act(async () => { native.back?.(); });
  expect(navigation.route).toBeNull();
});
