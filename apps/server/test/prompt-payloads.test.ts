/** @file Verifies provider request data, model overrides, picture normalization, and cancellation with mocked transports. */

import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import { openAIProvider } from '../src/provider';
import { openAIPictureProvider } from '../src/pictures/provider';
import { openAISynthesis, speechProfile } from '../src/synthesis';
import { boardPrompts, picturePrompts, pictureGenerationPrompt, pictureSelectionInstructions, pictureReviewInstructions, speechInstructions } from '../src/prompts';
import { type ProposalRequest, type PictureConcept } from '@little-say/core';

const calls = vi.hoisted(() => ({ parse: vi.fn(), generate: vi.fn(), send: vi.fn(), connect: vi.fn(), client: vi.fn() }));
vi.mock('openai', async importOriginal => ({
  ...await importOriginal<typeof import('openai')>(),
  default: class {
    /** Capture client options without opening a connection. */
    constructor(options: unknown) { calls.client(options); }
    responses = { parse: calls.parse };
    images = { generate: calls.generate };
  },
}));
vi.mock('openai/realtime/ws', () => ({
  OpenAIRealtimeWS: class extends EventEmitter {
    socket = new EventEmitter();
    /** Announce a synthetic session after the caller attaches listeners. */
    constructor(options: unknown) { super(); calls.connect(options); queueMicrotask(() => this.emit('session.created')); }
    /** Return matching speech without network or model calls. */
    send(payload: unknown) {
      calls.send(payload);
      this.emit('response.output_audio.delta', { delta: Buffer.alloc(2).toString('base64') });
      this.emit('response.output_audio_transcript.done', { transcript: 'Bonjour' });
      this.emit('response.done', { response: { status: 'completed' } });
    }
    /** No resources are owned by this transport fixture. */
    close() {}
  },
}));
beforeEach(() => vi.clearAllMocks());

const data = 'Café 牛 "quoted" \\ $& $` $\' $$ {{language}} {{concept}}\nsecond line';
const concept: PictureConcept = { description: data, features: [data], searchTerms: [data], emojiAccurate: false };
const environments = [
  { name: 'default', env: { AAC_OPENAI_KEY: 'synthetic-key' }, board: 'gpt-6.1-sol', effort: 'low', image: 'gpt-image-2.5-flare', speech: 'gpt-realtime-2.1-mini', voice: 'marin' },
  { name: 'configured', env: { AAC_OPENAI_KEY: 'synthetic-key', OPENAI_BOARD_MODEL: 'custom-board', OPENAI_REASONING_EFFORT: 'high', OPENAI_IMAGE_MODEL: 'custom-image', OPENAI_SPEECH_MODEL: 'custom-speech', OPENAI_SPEECH_VOICE: 'cedar' }, board: 'custom-board', effort: 'high', image: 'custom-image', speech: 'custom-speech', voice: 'cedar' },
];

function expectTextRequest(system: string, input: unknown, name: string) {
  expect(calls.parse.mock.lastCall![0]).toMatchObject({ store: false,
    input: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }],
    text: { format: { name, strict: true } },
  });
}

it.each(environments)('keeps board data literal and honors $name model settings', async ({ env, board, effort }) => {
  const provider = openAIProvider(env)!;
  const request: ProposalRequest = { prompt: data, board: null, languageProfile: { defaultLanguage: 'fr-FR', languages: ['fr-FR', 'ja-JP'] }, conversation: { history: [{ prompt: data, reply: data }], draft: null } };
  const draft = { title: data, explanation: data, needsClarification: false, tiles: [], picturePolicy: { mode: 'auto', style: 'line', consistent: false } };
  calls.parse.mockResolvedValue({ status: 'completed', output_parsed: draft });
  for (const pictureCapability of [undefined, 1] as const) {
    const input = { ...request, ...(pictureCapability ? { pictureCapability } : {}) };
    const result = await provider.propose(input);
    expectTextRequest(boardPrompts.instructions + (pictureCapability ? boardPrompts.pictures : ''), input, pictureCapability ? 'picture_soundboard' : 'soundboard');
    expect(calls.parse.mock.lastCall![0]).toMatchObject({ model: board, reasoning: { effort }, max_output_tokens: pictureCapability ? 14000 : 12000 });
    expect(result).toEqual(pictureCapability ? { ...draft, picturePolicy: { ...draft.picturePolicy, style: 'color' } } : draft);
  }
  const translation = { boardId: 'board-1', baseRevision: 2, tiles: [{ id: 'tile-1', label: data, speech: data, language: 'fr-FR', targets: ['ja-JP'] }] };
  calls.parse.mockResolvedValue({ status: 'completed', output_parsed: { translations: [] } });
  expect(await provider.translate!(translation)).toEqual({ translations: [] });
  expectTextRequest(boardPrompts.translation, translation, 'translations');
  expect(calls.parse.mock.lastCall![0]).toMatchObject({ model: board, reasoning: { effort } });
  expect(calls.client).toHaveBeenCalledWith({ apiKey: 'synthetic-key', timeout: 45000, maxRetries: 0 });
});

it('retains picture protection and locks only deliberate replacement choices', async () => {
  const tile = { existingId: 'cow', label: 'Cow', speech: 'Cow', language: 'en-US', emoji: '🐄', color: 'sage' as const };
  const previous = { title: 'Farm', explanation: 'Farm', needsClarification: false, tiles: [{ ...tile, pictureOptions: { locked: true, instruction: '' } }] };
  const request: ProposalRequest = { prompt: 'Change the words', board: null, pictureCapability: 1, conversation: { history: [], draft: previous } };
  const provider = openAIProvider({ AAC_OPENAI_KEY: 'synthetic-key' })!;
  for (const [replacePicture, pictureInstruction, pictureMode, locked] of [
    [false, '', null, true], [true, '', null, false], [true, 'A red cow', null, true], [true, '', 'library', true],
  ] as const) {
    calls.parse.mockResolvedValue({ status: 'completed', output_parsed: {
      ...previous, picturePolicy: { mode: 'auto', style: 'line', consistent: false },
      tiles: [{ ...tile, replacePicture, pictureInstruction, pictureMode, pictureStyle: 'line', pictureConcept: concept }],
    } });
    const result = await provider.propose(request);
    expect(result.tiles[0]).toEqual({ ...tile, replacePicture, pictureConcept: concept, pictureOptions: { locked, instruction: pictureInstruction, ...(pictureMode ? { mode: pictureMode } : {}) } });
  }
});

it.each(environments)('passes actual candidate pixels and bounded generation options with $name models', async ({ env, board, image }) => {
  const pictures = openAIPictureProvider(env)!;
  const signal = new AbortController().signal;
  const candidate = { id: 'candidate-1', name: data, bytes: Buffer.from('synthetic image bytes') };
  const pixels = { type: 'input_image', image_url: `data:image/png;base64,${candidate.bytes.toString('base64')}`, detail: 'auto' };
  const analysis = { tiles: [{ id: 'tile-1', label: data, emoji: '🐄', language: 'fr-FR', instruction: data }] };
  calls.parse.mockResolvedValue({ status: 'completed', output_parsed: { tiles: [{ id: 'tile-1', concept }] } });
  await pictures.analyze(analysis);
  expectTextRequest(picturePrompts.analysis, analysis, 'picture_concepts');
  calls.parse.mockResolvedValue({ status: 'completed', output_parsed: { id: candidate.id } });
  expect(await pictures.select(concept, [candidate], [data], signal)).toBe(candidate.id);
  expect(calls.parse).toHaveBeenLastCalledWith(expect.objectContaining({ model: board, store: false, input: [
    { role: 'system', content: pictureSelectionInstructions },
    { role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ concept, neighbors: [data] }) }, { type: 'input_text', text: JSON.stringify({ id: candidate.id, name: data }) }, pixels] },
  ] }), { signal });
  calls.generate.mockResolvedValue({ data: [{ b64_json: Buffer.from('image').toString('base64') }] });
  for (const style of ['color', 'line'] as const) {
    expect(await pictures.generate(concept, style, signal)).toEqual(Buffer.from('image'));
    expect(calls.generate).toHaveBeenLastCalledWith({ model: image, n: 1, size: '1024x1024', quality: 'medium', background: 'transparent', output_format: 'png', moderation: 'auto', prompt: pictureGenerationPrompt(picturePrompts[style], concept) }, { signal });
  }
  calls.parse.mockResolvedValue({ status: 'completed', output_parsed: { rejected: [candidate.id] } });
  expect(await pictures.review([{ ...candidate, concept }])).toEqual([candidate.id]);
  expect(calls.parse).toHaveBeenLastCalledWith(expect.objectContaining({ model: board, store: false, input: [
    { role: 'system', content: pictureReviewInstructions },
    { role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ id: candidate.id, concept }) }, pixels] },
  ] }), { timeout: 50000 });
  expect(calls.client).toHaveBeenCalledWith({ apiKey: 'synthetic-key', timeout: 180000, maxRetries: 0 });
});

it.each(environments)('uses $name speech settings with literal language and text input', async ({ env, speech, voice }) => {
  const profile = speechProfile(env);
  expect(profile).toEqual({ model: speech, voice, version: 1, format: 'wav-24000-mono' });
  const generate = openAISynthesis(env, profile)!;
  for (const language of ['en-US', 'fr-FR', 'ja-JP', data]) {
    const input = { text: 'Bonjour', language };
    const audio = await generate(input);
    expect(audio.subarray(0, 4).toString()).toBe('RIFF');
    expect(calls.send).toHaveBeenLastCalledWith({ type: 'response.create', response: {
      conversation: 'none', output_modalities: ['audio'], max_output_tokens: 1024,
      audio: { output: { voice, format: { type: 'audio/pcm', rate: 24000 } } },
      instructions: speechInstructions(language),
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
    } });
  }
  expect(calls.connect).toHaveBeenCalledWith({ model: speech, options: { handshakeTimeout: 10000 } });
});

it('makes no provider calls without a key or when there are no pictures to inspect', async () => {
  expect(openAIProvider({})).toBeNull();
  expect(openAIPictureProvider({})).toBeUndefined();
  expect(openAISynthesis({}, speechProfile({}))).toBeNull();
  expect(calls.client).not.toHaveBeenCalled();
  const pictures = openAIPictureProvider({ AAC_OPENAI_KEY: 'synthetic-key' })!;
  expect(await pictures.select(concept, [], [], new AbortController().signal)).toBeNull();
  expect(await pictures.review([])).toEqual([]);
  expect(calls.parse).not.toHaveBeenCalled();
});
