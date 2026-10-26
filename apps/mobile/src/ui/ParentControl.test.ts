/** @file Verifies native one-second automatic unlock, visible progress, cancellation, and release without relocking. */

import React, { act, useState } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParentControl } from './ParentControl';
import { useParentHold } from './useParentHold';

const lifecycle = vi.hoisted(() => ({ changed: (_state: string) => {} }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: { addEventListener: (_name: string, changed: (state: string) => void) => { lifecycle.changed = changed; return { remove() {} }; } }, View: 'View', Text: 'Text', StyleSheet: { create: (styles: unknown) => styles } }));
vi.mock('lucide-react-native', () => ({ LockKeyhole: 'LockKeyhole', LockKeyholeOpen: 'LockKeyholeOpen' }));

let renderer: ReactTestRenderer;
const unlock = vi.fn(), lock = vi.fn();
function Harness({ cancelToken = 0 }: { cancelToken?: number }) {
  const [locked, setLocked] = useState(true);
  const hold = useParentHold(cancelToken, () => { unlock(); setLocked(false); });
  return React.createElement(React.Fragment, null,
    React.createElement(ParentControl, { locked, hold, onLock: () => { lock(); setLocked(true); } }),
    React.createElement(Text, null, locked ? hold.label : 'Unlocked'),
    React.createElement(View, { testID: 'progress', accessibilityValue: { now: hold.progress } }));
}
const point = (id = 1, x = 24, count = 1) => ({ nativeEvent: { identifier: id, pageX: x, pageY: 24, touches: Array.from({ length: count }, (_, identifier) => ({ identifier })) } });
const control = () => renderer.root.findByProps({ accessibilityRole: 'button' });
const label = () => renderer.root.findByType(Text).children.join('');
async function touch(name: 'onTouchStart' | 'onTouchMove' | 'onTouchEnd' | 'onTouchCancel', event = point()) { await act(async () => { control().props[name](event); }); }
async function advance(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }
beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); unlock.mockClear(); lock.mockClear();
  await act(async () => { renderer = create(React.createElement(Harness), { createNodeMock: () => ({ measureInWindow: (fn: (...bounds: number[]) => void) => fn(0, 0, 48, 48) }) }); });
  await act(async () => { control().props.onLayout(); });
});
afterEach(async () => {
  await act(async () => { renderer.unmount(); });
  expect(vi.getTimerCount()).toBe(0);
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('native automatic unlock', () => {
  it('shows progress, unlocks at one second before release, and needs a fresh tap to relock', async () => {
    await touch('onTouchStart'); await advance(500);
    expect(renderer.root.findByProps({ testID: 'progress' }).props.accessibilityValue.now).toBeCloseTo(.5, 1);
    await advance(499); expect(label()).toBe('Unlocking…'); expect(unlock).not.toHaveBeenCalled();
    await advance(1); expect(unlock).toHaveBeenCalledOnce(); expect(label()).toBe('Unlocked');
    await touch('onTouchEnd'); await touch('onTouchEnd'); expect(lock).not.toHaveBeenCalled();
    await touch('onTouchStart'); await touch('onTouchEnd'); expect(lock).toHaveBeenCalledOnce();
    await touch('onTouchStart'); await advance(1000); expect(unlock).toHaveBeenCalledTimes(2);
  });
  it('reschedules early timers and ignores wall-clock changes', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    await touch('onTouchStart'); clock.mockReturnValue(999); await advance(1000);
    expect(unlock).not.toHaveBeenCalled(); expect(label()).toBe('Unlocking…');
    vi.setSystemTime(new Date('2000-01-01')); clock.mockReturnValue(1000); await advance(1);
    expect(unlock).toHaveBeenCalledOnce(); await touch('onTouchEnd'); expect(lock).not.toHaveBeenCalled();
  });
  it('clears progress and cancels when the finger moves too far', async () => {
    await touch('onTouchStart'); await advance(500); await touch('onTouchMove', point(1, 37));
    expect(label()).toBe('Locked · hold 1 s to unlock');
    expect(renderer.root.findByProps({ testID: 'progress' }).props.accessibilityValue.now).toBe(0);
    await advance(1000); await touch('onTouchEnd'); expect(unlock).not.toHaveBeenCalled();
  });
  it('requires a fresh full hold after releasing early', async () => {
    await touch('onTouchStart'); await advance(500); await touch('onTouchEnd');
    await touch('onTouchStart'); await advance(999); expect(unlock).not.toHaveBeenCalled();
    await advance(1); expect(unlock).toHaveBeenCalledOnce();
  });
  it('cancels when a second finger joins before the threshold', async () => {
    await touch('onTouchStart'); await advance(500); await touch('onTouchStart', point(2, 24, 2));
    await advance(1000); await touch('onTouchEnd', point(2)); await touch('onTouchEnd'); expect(unlock).not.toHaveBeenCalled();
    await touch('onTouchStart'); await advance(1000); expect(unlock).toHaveBeenCalledOnce();
  });
  it('cancels pending native and external attempts and clears timers on unmount', async () => {
    await touch('onTouchStart'); await advance(500); await touch('onTouchCancel'); await advance(1000);
    expect(unlock).not.toHaveBeenCalled();
    await touch('onTouchStart'); await advance(500);
    await act(async () => renderer.update(React.createElement(Harness, { cancelToken: 1 })));
    await advance(1000); expect(unlock).not.toHaveBeenCalled();
    await touch('onTouchStart');
  });
});

describe('assistive unlock and bounds', () => {
  const activate = async () => { await act(async () => control().props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } })); };
  it('announces a cancellable one-second alternative and completes only once', async () => {
    await activate(); expect(label()).toContain('Activate to cancel'); await advance(999); expect(unlock).not.toHaveBeenCalled();
    await advance(1); expect(unlock).toHaveBeenCalledOnce(); await advance(2000); expect(unlock).toHaveBeenCalledOnce();
  });
  it('cancels assistive and backgrounded attempts before accepting a fresh hold', async () => {
    await activate(); await advance(500); await activate(); await advance(1000); expect(unlock).not.toHaveBeenCalled();
    await activate(); await advance(500); await act(async () => lifecycle.changed('background'));
    await advance(1000); expect(unlock).not.toHaveBeenCalled();
    await touch('onTouchStart'); await advance(1000); expect(unlock).toHaveBeenCalledOnce();
  });
  it('cancels on leaving an edge before completion even within the movement tolerance', async () => {
    await touch('onTouchStart', point(1, 47)); await advance(500);
    await touch('onTouchMove', point(1, 49)); await advance(1000); await touch('onTouchEnd', point(1, 49));
    expect(unlock).not.toHaveBeenCalled();
  });
});
