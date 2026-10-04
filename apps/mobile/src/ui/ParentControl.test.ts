/** @file Verifies native unlock feedback and release handling share the same readiness threshold. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParentControl } from './ParentControl';

vi.mock('react-native', () => ({ View: 'View', Text: 'Text', StyleSheet: { create: (styles: unknown) => styles } }));
vi.mock('lucide-react-native', () => ({ LockKeyhole: 'LockKeyhole' }));

let renderer: ReactTestRenderer;
const exit = vi.fn();
const point = (id = 1, x = 50, count = 1) => ({ nativeEvent: { identifier: id, pageX: x, pageY: 50, touches: Array.from({ length: count }, (_, identifier) => ({ identifier })) } });
const control = () => renderer.root.findByProps({ testID: 'parent-control' });
const label = () => renderer.root.findByType(Text).children.join('');
async function touch(name: 'onTouchStart' | 'onTouchMove' | 'onTouchEnd' | 'onTouchCancel', event = point()) { await act(async () => { control().props[name](event); }); }
async function advance(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }
beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); exit.mockClear();
  await act(async () => { renderer = create(React.createElement(ParentControl, { cancelToken: 0, onExitRequest: exit })); });
});
afterEach(async () => {
  await act(async () => { renderer.unmount(); });
  expect(vi.getTimerCount()).toBe(0);
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('native parent unlock feedback', () => {
  it('accepts release immediately when the label becomes ready', async () => {
    await touch('onTouchStart'); await advance(1999);
    expect(label()).toBe('Keep holding…'); expect(exit).not.toHaveBeenCalled();
    await advance(1); expect(label()).toBe('Release to continue');
    await touch('onTouchEnd'); expect(exit).toHaveBeenCalledOnce(); expect(label()).toBe('Hold to unlock');
    await touch('onTouchEnd'); expect(exit).toHaveBeenCalledOnce();
  });
  it('reschedules early timers and ignores wall-clock changes', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    await touch('onTouchStart');
    clock.mockReturnValue(1999); await advance(2000); expect(label()).toBe('Keep holding…');
    clock.mockReturnValue(2000); await advance(1); expect(label()).toBe('Release to continue');
    vi.setSystemTime(new Date('2000-01-01'));
    await touch('onTouchEnd'); expect(exit).toHaveBeenCalledOnce();
  });
  it('resets feedback on movement and cannot show ready for a cancelled gesture', async () => {
    await touch('onTouchStart'); await advance(700);
    await touch('onTouchMove', point(1, 63)); expect(label()).toBe('Hold to unlock');
    await advance(5000); expect(label()).toBe('Hold to unlock');
    await touch('onTouchEnd'); expect(exit).not.toHaveBeenCalled();
    await touch('onTouchStart'); await advance(2000); await touch('onTouchEnd'); expect(exit).toHaveBeenCalledOnce();
  });
  it('requires a fresh full hold after releasing early and pressing again', async () => {
    await touch('onTouchStart'); await advance(1000); await touch('onTouchEnd');
    await touch('onTouchStart'); await advance(1000); expect(label()).toBe('Keep holding…');
    await advance(999); expect(label()).toBe('Keep holding…');
    await advance(1); expect(label()).toBe('Release to continue');
    await touch('onTouchEnd'); expect(exit).toHaveBeenCalledOnce();
  });
  it('cancels immediately if another finger joins, even after readiness', async () => {
    await touch('onTouchStart'); await advance(2000); expect(label()).toBe('Release to continue');
    await touch('onTouchStart', point(2, 50, 2)); expect(label()).toBe('Hold to unlock');
    await advance(3000); expect(label()).toBe('Hold to unlock');
    await touch('onTouchEnd', point(2)); await touch('onTouchEnd'); expect(exit).not.toHaveBeenCalled();
    await touch('onTouchStart'); await advance(2000); await touch('onTouchEnd'); expect(exit).toHaveBeenCalledOnce();
  });
  it('clears readiness on native cancellation and external board/background cancellation', async () => {
    await touch('onTouchStart'); await advance(2000); await touch('onTouchCancel');
    expect(label()).toBe('Hold to unlock'); await touch('onTouchEnd'); expect(exit).not.toHaveBeenCalled();
    await touch('onTouchStart'); await advance(2000);
    await act(async () => { renderer.update(React.createElement(ParentControl, { cancelToken: 1, onExitRequest: exit })); });
    expect(label()).toBe('Hold to unlock'); await touch('onTouchEnd'); expect(exit).not.toHaveBeenCalled();
    await touch('onTouchStart'); // afterEach verifies unmount clears this pending timer.
  });
});
