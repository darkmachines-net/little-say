/** @file Verifies account activity stops when hidden and drops a late response from another account. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useAiActivity } from './aiActivity';

const fetchActivity = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ apiFetch: fetchActivity, ApiError: Error }));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove: vi.fn() }) } }));

let screen: ReactTestRenderer | undefined;
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks();
});

it('scopes live counts and aborts polling on account and visibility changes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const empty = { queued: 0, working: 0 };
  const first = { boards: { queued: 1, working: 1 }, speech: empty, other: empty };
  const second = { boards: empty, speech: { queued: 1, working: 0 }, other: empty };
  let resolveOld!: (activity: typeof first) => void;
  fetchActivity.mockResolvedValueOnce(first).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(second);
  let activity: ReturnType<typeof useAiActivity>;
  function Harness({ account, visible }: { account: string; visible: boolean }) {
    activity = useAiActivity('https://app.example', account, visible); return null;
  }
  await act(async () => { screen = create(React.createElement(Harness, { account: 'first', visible: true })); });
  expect(activity).toEqual(first);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  const staleSignal: AbortSignal = fetchActivity.mock.calls[1][3];
  expect(staleSignal.aborted).toBe(false);
  await act(async () => screen!.update(React.createElement(Harness, { account: 'second', visible: true })));
  expect(staleSignal.aborted).toBe(true);
  await act(async () => { resolveOld(first); });
  expect(activity).toEqual(second);
  await act(async () => screen!.update(React.createElement(Harness, { account: 'second', visible: false })));
  expect(activity).toBeUndefined();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(fetchActivity).toHaveBeenCalledTimes(3);
});
