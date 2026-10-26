/** @file Verifies Android Back follows the board lock state, stops playback only on exit, and cleans up pending navigation. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Board, Settings } from '@little-say/core';
import { PlayBoard } from './PlayBoard';

const native = vi.hoisted(() => ({ back: null as null | (() => boolean) }));
const queue = vi.hoisted(() => ({ stop: vi.fn(), enqueue: vi.fn() }));
vi.mock('react-native', () => ({
  Platform: { OS: 'android' }, View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles }, useWindowDimensions: () => ({ width: 390, height: 844 }),
  AppState: { addEventListener: () => ({ remove() {} }) },
  BackHandler: { addEventListener: (_event: string, callback: () => boolean) => { native.back = callback; return { remove: () => { native.back = null; } }; } },
}));
vi.mock('lucide-react-native', () => ({ ArrowLeft: 'ArrowLeft', LockKeyhole: 'LockKeyhole', LockKeyholeOpen: 'LockKeyholeOpen' }));
vi.mock('expo-keep-awake', () => ({ useKeepAwake() {} }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('../services/speech', () => ({ speechQueue: () => queue }));
vi.mock('./TouchSurface', () => ({ TouchSurface: 'TouchSurface' }));
vi.mock('./components', () => ({ Notice: 'Notice' }));
vi.mock('./screenFocus', () => ({ useScreenFocus: () => null }));

const board: Board = { id: 'board', title: 'Farm', revision: 1, createdAt: '', updatedAt: '', tiles: [
  { id: 'cow', label: 'Cow', speech: 'Cow', language: 'en-US', color: 'sage', illustration: { kind: 'emoji', emoji: '🐄' } },
] };
const settings: Settings = { backendUrl: '', voices: {}, activeBoardId: board.id, aiConsent: false, autoSpeech: true };
const onEdit = vi.fn();
let screen: ReactTestRenderer | undefined;
let delayedMeasurement: (() => void) | undefined;

async function mount(delayMeasurement = false) {
  await act(async () => {
    screen = create(React.createElement(PlayBoard, { board, settings, voices: [], audioAsset: () => undefined, onLanguageChange: async () => {}, onEdit }), {
      createNodeMock: element => ({ measureInWindow: (callback: (...bounds: number[]) => void) => {
        if ((element.props as { testID?: string }).testID === 'board-lock') callback(0, 0, 48, 48);
        else if (delayMeasurement) delayedMeasurement = () => callback(16, 96, 358, 700);
        else callback(16, 96, 358, 700);
      } }),
    });
  });
  await act(async () => {
    screen!.root.findByProps({ testID: 'board-lock' }).props.onLayout();
    screen!.root.find(node => node.props.collapsable === false && !node.props.testID).props.onLayout({ nativeEvent: { layout: { width: 358, height: 700 } } });
  });
}
const control = () => screen!.root.findAll(node => node.props.testID === 'board-lock' || node.props.testID === 'parent-control')[0];
const point = { nativeEvent: { identifier: 1, pageX: 24, pageY: 24, touches: [{ identifier: 1 }] } };
async function touch(name: 'onTouchStart' | 'onTouchEnd') { await act(async () => { control().props[name](point); }); }
async function back() { await act(async () => { expect(native.back?.()).toBe(true); }); }
async function advance(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); delayedMeasurement = undefined; });
afterEach(async () => {
  if (screen) await act(async () => { screen!.unmount(); });
  screen = undefined;
  expect(native.back).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it('returns an unlocked board to its editor exactly once and stops playback', async () => {
  await mount(); await back(); await back(); await advance(100);
  expect(onEdit).toHaveBeenCalledOnce();
  expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ x: 16, y: 96, width: 358, height: 700, tiles: board.tiles, viewport: { width: 390, height: 844 } }));
  expect(queue.stop).toHaveBeenCalledOnce();
});

it('blocks Back only while locked, including a partial hold and a fresh relock', async () => {
  await mount(); await touch('onTouchStart'); await touch('onTouchEnd'); await back();
  await touch('onTouchStart'); await advance(999); await back();
  expect(onEdit).not.toHaveBeenCalled(); expect(queue.stop).not.toHaveBeenCalled();
  await advance(1); await touch('onTouchEnd');
  await touch('onTouchStart'); await touch('onTouchEnd'); await back();
  expect(onEdit).not.toHaveBeenCalled(); expect(queue.stop).not.toHaveBeenCalled();
  await touch('onTouchStart'); await advance(1000); await back();
  expect(onEdit).toHaveBeenCalledOnce(); expect(queue.stop).toHaveBeenCalledOnce();
});

it('still navigates if native measurement stalls and ignores its late callback', async () => {
  await mount(true); await back(); await back();
  expect(onEdit).not.toHaveBeenCalled();
  await advance(100); expect(onEdit).toHaveBeenCalledExactlyOnceWith(null);
  await act(async () => { delayedMeasurement?.(); });
  expect(onEdit).toHaveBeenCalledOnce();
});

it('cancels a pending Back navigation and removes its listener when unmounted', async () => {
  await mount(true); await back();
  await act(async () => { screen!.unmount(); }); screen = undefined;
  await advance(100); await act(async () => { delayedMeasurement?.(); });
  expect(onEdit).not.toHaveBeenCalled();
});
