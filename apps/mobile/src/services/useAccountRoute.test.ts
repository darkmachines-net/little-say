/** @file Verifies native authentication history restores form callers and authentication replacement discards old forms. */
import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAccountRoute } from './useAccountRoute';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
let screen: ReactTestRenderer | undefined;
let route: ReturnType<typeof useAccountRoute>;
function Harness() { route = useAccountRoute(); return null; }
beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); await act(async () => { screen = create(React.createElement(Harness)); }); });
afterEach(async () => { await act(async () => screen?.unmount()); vi.unstubAllGlobals(); });

it('returns from nested authentication forms to the exact caller', async () => {
  await act(async () => route.open());
  await act(async () => route.open('login'));
  await act(async () => route.open('reset'));
  await act(async () => route.back()); expect(route.route?.mode).toBe('login');
  await act(async () => route.back()); expect(route.route?.mode).toBeNull();
  await act(async () => route.close()); expect(route.route).toBeNull();
});
it('uses the logical parent for a direct link and drops auth history after sign-in', async () => {
  await act(async () => route.open('reset'));
  await act(async () => route.back()); expect(route.route?.mode).toBe('login');
  await act(async () => route.open('login'));
  await act(async () => route.open(null, true));
  await act(async () => route.open('register'));
  await act(async () => route.back()); expect(route.route?.mode).toBeNull();
  await act(async () => route.back()); expect(route.route?.mode).toBeNull();
});
