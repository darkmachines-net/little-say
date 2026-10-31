/** @file Verifies shared-header Android creation exits, empty-draft protection, retention, and failed-write recovery. */

import React, { act, type ReactNode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type BoardCreationDraft, defaultPicturePolicy } from '@little-say/core';
import { starterLibrary } from '../../../../tests/fixtures/library';
import { AiConversation } from './AiConversation';
import { Button, Notice, Sheet } from './components';

const calls = vi.hoisted(() => ({ back: null as (() => boolean) | null, save: vi.fn(), discard: vi.fn(), close: vi.fn(), guard: vi.fn() }));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', TextInput: 'TextInput', ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'android' },
  Keyboard: { dismiss: vi.fn() },
  useWindowDimensions: () => ({ width: 1180, height: 900 }),
  BackHandler: { addEventListener: (_event: string, handler: () => boolean) => { calls.back = handler; return { remove: () => { calls.back = null; } }; } },
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('lucide-react-native', () => ({ ArrowLeft: 'ArrowLeft', ArrowUp: 'ArrowUp', SlidersHorizontal: 'SlidersHorizontal', Square: 'Square' }));
vi.mock('./components', () => ({
  Button: (props: { children?: ReactNode }) => React.createElement('Button', props, props.children),
  Notice: (props: { children?: ReactNode }) => React.createElement('Notice', props, props.children),
  Sheet: (props: { children?: ReactNode; footer?: ReactNode }) => React.createElement('Sheet', props, props.children, props.footer),
}));
vi.mock('./Brand', () => ({ Brand: 'Brand', MountainMark: 'MountainMark' }));
vi.mock('./screenFocus', () => ({ useScreenFocus: () => ({ current: null }) }));
vi.mock('./DraftCanvas', () => ({ DraftCanvas: 'DraftCanvas' }));
vi.mock('./PicturePreferences', () => ({ PictureGenerationInfo: 'PictureGenerationInfo', PicturePreferences: 'PicturePreferences', pictureDataDisclosure: 'Picture disclosure.' }));
vi.mock('../services/api', () => ({ proposeBoard: vi.fn() }));
vi.mock('../services/pictures', () => ({ prepareProposalPictures: vi.fn(), proposalPreview: vi.fn() }));

let screen: ReactTestRenderer | undefined;
const progress: BoardCreationDraft = { prompt: 'Cow and sheep', history: [], draft: null, picturePolicy: defaultPicturePolicy, clarifying: false };
async function mount(savedDraft?: BoardCreationDraft) {
  await act(async () => { screen = create(React.createElement(AiConversation, { settings: starterLibrary().settings, savedDraft, onSaveDraft: calls.save, onDiscardDraft: calls.discard, onBeforeClose: calls.guard, onClose: calls.close, onApply: vi.fn(), onAiUse: vi.fn() })); });
}
const buttons = () => screen!.root.findAllByType(Button);
const button = (label: string) => buttons().find(node => node.props.children === label || node.props.accessibilityLabel === label)!;
async function press(label: string) { await act(async () => { await button(label).props.onPress(); }); }

beforeEach(() => {
  vi.clearAllMocks();
  calls.save.mockResolvedValue(undefined); calls.discard.mockResolvedValue(undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => { if (screen) await act(async () => screen!.unmount()); screen = undefined; vi.unstubAllGlobals(); });

it('prompts on Android Back even when empty, and discards without saving progress', async () => {
  await mount();
  await act(async () => { expect(calls.back?.()).toBe(true); });
  expect(screen!.root.findByType(Sheet).props.title).toBe('Save your draft?');
  expect(button('Save draft').props.disabled).toBe(true);
  await press('Discard');
  expect(calls.discard).toHaveBeenCalledOnce(); expect(calls.save).not.toHaveBeenCalled(); expect(calls.close).toHaveBeenCalledOnce();
});

it('keeps the unsent prompt on cancel and saves only after the explicit choice', async () => {
  await mount(progress);
  await press('Back to boards'); await press('Keep editing');
  expect(screen!.root.findAllByType(Sheet)).toHaveLength(0);
  expect(screen!.root.findByType(TextInput).props.value).toBe(progress.prompt);
  expect(calls.save).not.toHaveBeenCalled(); expect(calls.discard).not.toHaveBeenCalled(); expect(calls.close).not.toHaveBeenCalled();
  await act(async () => { calls.back?.(); });
  await press('Save draft');
  expect(calls.save).toHaveBeenCalledWith(progress); expect(calls.close).toHaveBeenCalledOnce();
});

it.each(['Save draft', 'Discard'])('retains the exit dialog and blocks repeated Back while %s is pending or fails', async label => {
  let fail!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, reject) => { fail = reject; });
  const write = label === 'Save draft' ? calls.save : calls.discard;
  write.mockReturnValueOnce(pending);
  await mount(progress); await press('Back to boards');
  await act(async () => { void button(label).props.onPress(); });
  expect(button('Discard').props.disabled).toBe(true);
  await act(async () => { calls.back?.(); });
  await press('Keep editing');
  expect(screen!.root.findAllByType(Sheet)).toHaveLength(1); expect(calls.close).not.toHaveBeenCalled();
  await act(async () => { fail(new Error('Storage full')); });
  expect(screen!.root.findByType(Notice).props.children).toContain('Please try again.');
  expect(button(label).props.disabled).toBe(false);
  expect(screen!.root.findByType(TextInput).props.value).toBe(progress.prompt);
  await press(label);
  expect(calls.close).toHaveBeenCalledOnce();
});
