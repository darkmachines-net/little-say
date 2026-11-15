/** @file Verifies a rejected prompt stays editable and is never replayed when its retry window ends. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { starterLibrary } from '../../../../tests/fixtures/library';
import { AiAdmissionError, proposeBoard } from './api';
import { useBoardAssistant } from './useBoardAssistant';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('./requestAuth', () => ({ applicationHeaders: vi.fn() }));
vi.mock('./pictures', () => ({ prepareProposalPictures: vi.fn() }));
vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(), proposeBoard: vi.fn() }));

let screen: ReactTestRenderer | undefined;
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks();
});

it('updates the countdown and accepts an explicit retry only after the server wait', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.mocked(proposeBoard).mockRejectedValueOnce(new AiAdmissionError('Wait', 3000, 'rate-limit'))
    .mockRejectedValueOnce(new Error('Offline'));
  const library = starterLibrary();
  const props = { board: library.boards[0], settings: { ...library.settings, aiConsent: true }, onConsent: vi.fn(), onDraft: vi.fn(), onAccept: vi.fn(), onSpeechReady: vi.fn() };
  let assistant!: ReturnType<typeof useBoardAssistant>;
  function Harness() { assistant = useBoardAssistant(props); return null; }
  await act(async () => { screen = create(React.createElement(Harness)); });
  await act(async () => assistant.setPrompt('Add five animal cards'));
  await act(async () => assistant.generate());
  expect(assistant.prompt).toBe('Add five animal cards');
  expect(assistant.retrySeconds).toBe(3);
  await act(async () => { assistant.setPrompt('Add six animal cards'); });
  await act(async () => assistant.generate());
  expect(proposeBoard).toHaveBeenCalledOnce();
  for (const seconds of [2, 1, 0]) {
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(assistant.retrySeconds).toBe(seconds);
  }
  expect(proposeBoard).toHaveBeenCalledOnce();
  await act(async () => assistant.generate());
  expect(vi.mocked(proposeBoard).mock.calls[1][1].prompt).toBe('Add six animal cards');
});
