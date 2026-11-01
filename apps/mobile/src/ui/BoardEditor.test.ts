/** @file Verifies native picture-frame status, keyboard/input stability, Undo/Redo controls, draft exits, and failed-write recovery. */

import React, { act } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Board, Settings } from '@little-say/core';
import type { PictureTileState } from '../services/pictures';
import { BoardEditor } from './BoardEditor';

const native = vi.hoisted(() => ({
  platform: 'android', width: 390, height: 844, top: 48, visible: false,
  listeners: new Map<string, () => void>(),
}));
const state = vi.hoisted(() => ({ reply: '', prompt: 'Keep my words', busy: null as string | null, suggestion: null as object | null, clear: vi.fn(), preview: undefined as Board | undefined, states: {} as Record<string, PictureTileState> }));
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
  BackHandler: { addEventListener: (name: string, callback: () => void) => { native.listeners.set(name, callback); return { remove: () => native.listeners.delete(name) }; } },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: native.top }) }));
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft', Copy: 'Copy', Languages: 'Languages', Play: 'Play', Plus: 'Plus', Redo2: 'Redo2', Settings: 'Settings', Trash2: 'Trash2', Undo2: 'Undo2', Volume2: 'Volume2', ArrowUp: 'ArrowUp', Keyboard: 'Keyboard', Square: 'Square', X: 'X' }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'new-card' }));
vi.mock('./components', () => ({ Button: 'Button', Notice: 'Notice', Confirm: 'Confirm',
  /** Render dialog actions so native exit scenarios exercise their callbacks. */
  Sheet: (props: { children?: React.ReactNode; footer?: React.ReactNode }) => React.createElement('Sheet', props, props.children, props.footer),
}));
vi.mock('./BoardLanguages', () => ({ BoardLanguages: 'BoardLanguages' }));
vi.mock('./BoardPictures', () => ({ BoardPictures: 'BoardPictures' }));
vi.mock('./TileEditor', () => ({ TileEditor: 'TileEditor' }));
vi.mock('./TileFace', () => ({ TileFace: 'TileFace' }));
vi.mock('./BoardTransition', () => ({ BoardTransition: 'BoardTransition' }));
vi.mock('./AppHeader', () => ({ AppHeader: 'AppHeader' }));
vi.mock('./screenFocus', () => ({ useScreenFocus: () => null }));
vi.mock('../services/useBoardAssistant', () => ({
  /** Supply controlled previews and picture states while retaining the real editor/composer layout. */
  useBoardAssistant: ({ board }: { board: Board }) => ({
    preview: state.preview ?? board, prompt: state.prompt, reply: state.reply, history: [], scope: null, busy: state.busy,
    suggestion: state.suggestion, error: '', mergeError: '', progress: '', states: state.states, translations: [], conflicts: [],
    setPrompt: vi.fn(), clear: state.clear, stop: vi.fn().mockResolvedValue(true), generate: vi.fn(),
  }),
}));

const board: Board = { id: 'farm', title: 'Farm', revision: 1, createdAt: '', updatedAt: '', tiles: [
  { id: 'cow', label: 'Cow', speech: 'Cow', language: 'en-US', color: 'sage', illustration: { kind: 'emoji', emoji: '🐄' } },
] };
const settings: Settings = { backendUrl: '', voices: {}, activeBoardId: board.id, aiConsent: false, autoSpeech: true, voiceSources: { 'en-US': 'device' } };
const props: React.ComponentProps<typeof BoardEditor> = {
  board, settings, audio: {} as React.ComponentProps<typeof BoardEditor>['audio'],
  onPrepareTranslations: vi.fn(), onCancelTranslations: vi.fn(), onManageLanguages: vi.fn(),
  onDraft: vi.fn(), onSaveDraft: vi.fn(), onDiscardDraft: vi.fn(), onBeforeClose: vi.fn(), onAccept: vi.fn(), onStopPreview: vi.fn(), onBack: vi.fn(),
  /** Return the unchanged fixture; these scenarios exercise layout rather than persistence. */
  onChange: () => board,
  onPlay: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(), onConsent: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(),
  canUndo: false, canRedo: false, onPreview: vi.fn(), saving: false, startingPlay: false, returnToPlay: false,
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
  native.listeners.clear(); state.reply = ''; state.prompt = 'Keep my words'; state.busy = null; state.suggestion = null; state.preview = undefined; state.states = {};
  vi.clearAllMocks(); vi.mocked(props.onSaveDraft).mockResolvedValue(undefined); vi.mocked(props.onDiscardDraft).mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => { screen.unmount(); });
  expect(native.listeners.size).toBe(0); vi.unstubAllGlobals();
});

it('reserves picture space only for new pending cards and reveals usable fallbacks when work stops', async () => {
  state.preview = { ...board, tiles: [...board.tiles, { ...board.tiles[0], id: 'new-card', label: 'Sheep' }] };
  state.states = { cow: 'generating', 'new-card': 'loading' };
  await act(async () => { screen = create(React.createElement(BoardEditor, props)); });
  const faces = () => screen.root.findAllByType('TileFace' as never);
  expect(faces().map(face => [face.props.tile.label, face.props.picturePending])).toEqual([['Cow', false], ['Sheep', true]]);
  expect(faces().map(face => face.props.pictureState)).toEqual(['generating', 'loading']);
  state.states = {};
  await act(async () => { screen.update(React.createElement(BoardEditor, props)); });
  expect(faces().map(face => face.props.picturePending)).toEqual([false, false]);
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

const hosts = (name: string) => screen.root.findAll(node => typeof node.type === 'string' && String(node.type) === name);
const host = (name: string) => hosts(name)[0];
const toolbar = (label: string) => (React.Children.toArray(host('AppHeader').props.actions.props.children) as React.ReactElement<any>[]).find(element => element.props.accessibilityLabel === label)!.props;

it('exposes independent Undo/Redo controls and preserves unsent input during history navigation', async () => {
  await act(async () => { screen = create(React.createElement(BoardEditor, props)); });
  expect(toolbar('Undo last board change').disabled).toBe(true); expect(toolbar('Redo last board change').disabled).toBe(true);
  await act(async () => { screen.update(React.createElement(BoardEditor, { ...props, canRedo: true })); });
  expect(toolbar('Undo last board change').disabled).toBe(true); expect(toolbar('Redo last board change').disabled).toBe(false);
  await act(async () => toolbar('Redo last board change').onPress());
  expect(props.onRedo).toHaveBeenCalledOnce(); expect(props.onUndo).not.toHaveBeenCalled(); expect(state.clear).toHaveBeenCalledOnce();
  expect(input().props.value).toBe('Keep my words');
  await act(async () => { screen.update(React.createElement(BoardEditor, { ...props, canUndo: true })); });
  expect(toolbar('Undo last board change').disabled).toBe(false); expect(toolbar('Redo last board change').disabled).toBe(true);
  await act(async () => toolbar('Undo last board change').onPress()); expect(props.onUndo).toHaveBeenCalledOnce();
});

it.each(['AI request', 'AI save', 'preview', 'playback', 'dialog'])('disables both history controls during %s', async reason => {
  if (reason === 'AI request') state.busy = 'generate';
  if (reason === 'AI save') state.busy = 'save';
  if (reason === 'preview') state.suggestion = { board, base: board };
  await act(async () => { screen = create(React.createElement(BoardEditor, { ...props, canUndo: true, canRedo: true, startingPlay: reason === 'playback' })); });
  if (reason === 'dialog') await act(async () => toolbar('Board settings').onPress());
  expect(toolbar('Undo last board change').disabled).toBe(true); expect(toolbar('Redo last board change').disabled).toBe(true);
});

const emptyBoard: Board = { ...board, title: 'New board', tiles: [] };
async function createDraft(prompt = '') {
  state.prompt = prompt;
  await act(async () => { screen = create(React.createElement(BoardEditor, { ...props, board: emptyBoard, draft: { board: emptyBoard, prompt, suggestion: null } })); });
}
const exitButton = (label: string) => screen.root.findAll(node => typeof node.type === 'string' && String(node.type) === 'Button').find(node => node.props.children === label)!;
async function pressExit(label: string) { await act(async () => { await exitButton(label).props.onPress(); }); }
async function back() { await act(async () => { native.listeners.get('hardwareBackPress')?.(); }); }

it('asks before leaving an untouched creation on Android Back and disables saving empty progress', async () => {
  await createDraft(); await back();
  expect(host('Sheet').props.title).toBe('Save your draft?');
  expect(exitButton('Save draft').props.disabled).toBe(true);
  await pressExit('Discard');
  expect(props.onDiscardDraft).toHaveBeenCalledOnce(); expect(props.onSaveDraft).not.toHaveBeenCalled(); expect(props.onBack).toHaveBeenCalledOnce();
});

it('keeps unsent input on cancel and persists only after Save draft', async () => {
  await createDraft('Cow and sheep'); await back(); await pressExit('Keep editing');
  expect(hosts('Sheet')).toHaveLength(0);
  expect(input().props.value).toBe('Cow and sheep'); expect(props.onSaveDraft).not.toHaveBeenCalled();
  await back(); await pressExit('Save draft');
  expect(props.onSaveDraft).toHaveBeenCalledWith({ board: emptyBoard, prompt: 'Cow and sheep', suggestion: null, history: [], reply: '' });
  expect(props.onBack).toHaveBeenCalledOnce();
});

it.each(['Save draft', 'Discard'])('keeps the exit dialog and blocks Back/cancel while %s is pending or fails', async label => {
  let fail!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, reject) => { fail = reject; });
  const write = vi.mocked(label === 'Save draft' ? props.onSaveDraft : props.onDiscardDraft);
  write.mockReturnValueOnce(pending);
  await createDraft('Cow and sheep'); await back();
  await act(async () => { void exitButton(label).props.onPress(); });
  expect(exitButton('Discard').props.disabled).toBe(true);
  await back(); await pressExit('Keep editing');
  expect(hosts('Sheet')).toHaveLength(1); expect(props.onBack).not.toHaveBeenCalled();
  await act(async () => { fail(new Error('Storage full')); });
  expect(host('Notice').props.children).toContain('Please try again.');
  expect(exitButton(label).props.disabled).toBe(false); expect(input().props.value).toBe('Cow and sheep');
  await pressExit(label); expect(props.onBack).toHaveBeenCalledOnce();
});
