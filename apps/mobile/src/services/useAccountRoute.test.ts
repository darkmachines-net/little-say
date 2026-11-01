/** @file Verifies native account history restores exact callers and authentication replacement discards old forms. */
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

it('returns from nested management pages to the exact caller', async () => {
  await act(async () => route.open());
  await act(async () => route.open('backup'));
  await act(async () => route.open('verify-email'));
  await act(async () => route.back()); expect(route.route?.mode).toBe('backup');
  await act(async () => route.back()); expect(route.route?.mode).toBeNull();
  await act(async () => route.close()); expect(route.route).toBeNull();
});
it('uses the logical parent for a direct link and drops auth history after sign-in', async () => {
  await act(async () => route.open('link-email'));
  await act(async () => route.back()); expect(route.route?.mode).toBe('sign-in-methods');
  await act(async () => route.open('login'));
  await act(async () => route.open(null, true));
  await act(async () => route.open('delete'));
  await act(async () => route.back()); expect(route.route?.mode).toBeNull();
  await act(async () => route.back()); expect(route.route?.mode).toBeNull();
});
