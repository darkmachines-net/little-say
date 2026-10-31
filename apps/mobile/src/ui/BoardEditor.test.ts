/** @file Verifies native keyboard lifecycle, safe-area offsets, and a persistent composer outside all scrolling ancestors. */

import React, { act } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Board, Settings } from '@little-say/core';
import { BoardEditor } from './BoardEditor';

const native = vi.hoisted(() => ({
  platform: 'android', width: 390, height: 844, top: 48, visible: false,
  listeners: new Map<string, () => void>(),
}));
const state = vi.hoisted(() => ({ reply: '' }));
vi.mock('react-native', () => ({
  Platform: { get OS() { return native.platform; } },
  View: 'View', Text: 'Text', TextInput: 'TextInput', ScrollView: 'ScrollView', Pressable: 'Pressable',
  KeyboardAvoidingView: 'KeyboardAvoidingView', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: native.width, height: native.height }),
  Keyboard: {
    isVisible: () => native.visible, dismiss: vi.fn(),
    addListener: (name: string, callback: () => void) => { native.listeners.set(name, callback); return { remove: () => native.listeners.delete(name) }; },
  },
  BackHandler: { addEventListener: () => ({ remove() {} }) },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: native.top }) }));
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft', Copy: 'Copy', Languages: 'Languages', Play: 'Play', Plus: 'Plus', Settings: 'Settings', Trash2: 'Trash2', Undo2: 'Undo2', Volume2: 'Volume2', ArrowUp: 'ArrowUp', Keyboard: 'Keyboard', Square: 'Square', X: 'X' }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'new-card' }));
vi.mock('./components', () => ({ Button: 'Button', Notice: 'Notice', Sheet: 'Sheet', Confirm: 'Confirm' }));
vi.mock('./BoardLanguages', () => ({ BoardLanguages: 'BoardLanguages' }));
vi.mock('./BoardPictures', () => ({ BoardPictures: 'BoardPictures' }));
vi.mock('./TileEditor', () => ({ TileEditor: 'TileEditor' }));
vi.mock('./TileFace', () => ({ TileFace: 'TileFace' }));
vi.mock('./PictureStatus', () => ({ PictureStatus: 'PictureStatus' }));
vi.mock('./BoardTransition', () => ({ BoardTransition: 'BoardTransition' }));
vi.mock('./screenFocus', () => ({ useScreenFocus: () => null }));
vi.mock('../services/useBoardAssistant', () => ({
  useBoardAssistant: ({ board }: { board: Board }) => ({
    preview: board, prompt: 'Keep my words', reply: state.reply, scope: null, busy: null,
    suggestion: null, error: '', mergeError: '', progress: '', states: {}, translations: [],
    setPrompt: vi.fn(), clear: vi.fn(), stop: vi.fn(), generate: vi.fn(),
  }),
}));

const board: Board = { id: 'farm', title: 'Farm', revision: 1, createdAt: '', updatedAt: '', tiles: [
  { id: 'cow', label: 'Cow', speech: 'Cow', language: 'en-US', color: 'sage', illustration: { kind: 'emoji', emoji: '🐄' } },
] };
const settings: Settings = { backendUrl: '', voices: {}, activeBoardId: board.id, aiConsent: false, autoSpeech: true, voiceSources: { 'en-US': 'device' } };
const props: React.ComponentProps<typeof BoardEditor> = {
  board, settings, audio: {} as React.ComponentProps<typeof BoardEditor>['audio'],
  onDraft: vi.fn(), onAccept: vi.fn(), onStopPreview: vi.fn(), onBack: vi.fn(),
  /** Return the unchanged fixture; these scenarios exercise layout rather than persistence. */
  onChange: () => board,
  onPlay: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(), onConsent: vi.fn(), onUndo: vi.fn(),
  canUndo: false, onPreview: vi.fn(), saving: false, startingPlay: false, returnToPlay: false,
  transition: null, onTransitionDone: vi.fn(),
};
let screen: ReactTestRenderer;
const input = () => screen.root.find(node => typeof node.type === 'string' && node.props.accessibilityLabel === 'Message to AI');
async function render() { await act(async () => { screen.update(React.createElement(BoardEditor, props)); }); }
async function keyboard(visible: boolean) {
  native.visible = visible;
  const event = native.platform === 'ios' ? visible ? 'keyboardWillShow' : 'keyboardWillHide' : visible ? 'keyboardDidShow' : 'keyboardDidHide';
  await act(async () => { native.listeners.get(event)?.(); });
}
function expectFixedPrompt() {
  let ancestor: ReactTestInstance | null = input().parent;
  while (ancestor) { expect(ancestor.type).not.toBe('ScrollView'); ancestor = ancestor.parent; }
  expect(screen.root.findByProps({ testID: 'editor-preview' })).toBeDefined();
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(native, { width: 390, height: 844, top: 48, visible: false });
  native.listeners.clear(); state.reply = '';
});
afterEach(async () => {
  await act(async () => { screen.unmount(); });
  expect(native.listeners.size).toBe(0); vi.unstubAllGlobals();
});

it.each(['android', 'ios'])('keeps the same %s input across overlay, resize, rotation, replies, and repeated keyboard openings', async platform => {
  native.platform = platform;
  await act(async () => { screen = create(React.createElement(BoardEditor, props)); });
  const mountedInput = input();
  for (let cycle = 0; cycle < 3; cycle++) {
    await act(async () => { input().props.onFocus(); });
    await keyboard(true);
    expectFixedPrompt();
    expect(screen.root.findAllByProps({ testID: 'editor-heading' })).toHaveLength(0);
    // Overlay keyboards leave window dimensions unchanged; resized windows and rotation do not.
    for (const [width, height, top] of [[390, 844, 48], [390, 430, 48], [720, 330, 24]]) {
      Object.assign(native, { width, height, top });
      state.reply = 'A long clarification. '.repeat(40);
      await render();
      await act(async () => { screen.root.findByProps({ testID: 'editor-content' }).props.onLayout({ nativeEvent: { layout: { height: 240 } } }); });
      expectFixedPrompt(); expect(input()).toBe(mountedInput);
      expect(input().props.value).toBe('Keep my words');
      const viewport = screen.root.findByProps({ testID: 'board-workspace' });
      expect(viewport.props.behavior).toBe('padding');
      expect(viewport.props.keyboardVerticalOffset).toBe(top);
    }
    await keyboard(false);
    await act(async () => { input().props.onBlur(); });
    Object.assign(native, { width: 390, height: 844, top: 48 }); await render();
    expect(screen.root.findAllByProps({ testID: 'editor-heading' })).toHaveLength(1);
    expect(input()).toBe(mountedInput); expectFixedPrompt();
  }
});
