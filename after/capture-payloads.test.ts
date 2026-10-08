import { writeFileSync as saveCapture } from 'node:fs';
/** @file Locks model request bytes/options to the pre-extraction baseline using mocked OpenAI transports. */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { openAIProvider } from '../src/provider';
import { openAIPictureProvider } from '../src/picture-provider';
import { openAISynthesis, speechProfile } from '../src/synthesis';
import { type ProposalRequest, type PictureConcept } from '@little-say/core';

const calls = vi.hoisted(() => ({ parse: vi.fn(), generate: vi.fn(), transcribe: vi.fn(), send: vi.fn(), connections: [] as unknown[], clients: [] as unknown[] }));
vi.mock('openai', async importOriginal => ({
  ...await importOriginal<typeof import('openai')>(),
  default: class {
    constructor(options: unknown) { calls.clients.push(options); }
    responses = { parse: calls.parse };
    images = { generate: calls.generate };
    audio = { transcriptions: { create: calls.transcribe } };
  },
}));
vi.mock('openai/realtime/ws', () => ({
  OpenAIRealtimeWS: class extends EventEmitter {
    socket = new EventEmitter();
    constructor(options: unknown) { super(); calls.connections.push(options); queueMicrotask(() => this.emit('session.created')); }
    send(payload: unknown) {
      calls.send(payload);
      this.emit('response.output_audio.delta', { delta: Buffer.alloc(2).toString('base64') });
      this.emit('response.output_audio_transcript.done', { transcript: 'Bonjour' });
      this.emit('response.done', { response: { status: 'completed' } });
    }
    close() {}
  },
}));

// Hash the complete JSON request, including schema, model/options and whitespace inside every string.
// Baselines were captured by running these calls against master before changing production source.
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const data = 'Café 牛 "quoted" \\ $& $` $\' $$ {{language}} {{concept}}\nsecond line';

it('preserves complete board, picture, transcription and speech requests with literal hostile-looking data', async () => {
  const observed: Record<string, string> = {}; const payloads: Record<string, unknown> = {};
  const remember = (name: string, value: unknown) => { observed[name] = digest(value); payloads[name] = value; };
  for (const custom of [false, true]) {
    const env = { AAC_OPENAI_KEY: 'synthetic-key', ...(custom ? { OPENAI_BOARD_MODEL: 'custom-board', OPENAI_REASONING_EFFORT: 'high', OPENAI_TRANSCRIBE_MODEL: 'custom-transcribe', OPENAI_IMAGE_MODEL: 'custom-image', OPENAI_SPEECH_MODEL: 'custom-speech', OPENAI_SPEECH_VOICE: 'cedar' } : {}) };
    const prefix = custom ? 'configured' : 'default';
    const provider = openAIProvider(env)!;
    const request: ProposalRequest = { prompt: data, board: null, languageProfile: { defaultLanguage: 'fr-FR', languages: ['fr-FR', 'ja-JP'] }, conversation: { history: [{ prompt: data, reply: data }], draft: null } };
    calls.parse.mockResolvedValue({ status: 'completed', output_parsed: { title: data, tiles: [], picturePolicy: { mode: 'auto', style: 'color', consistent: false } } });
    for (const pictureCapability of [undefined, 1] as const) {
      await provider.propose({ ...request, ...(pictureCapability ? { pictureCapability } : {}) });
      remember(`${prefix}/board/${pictureCapability ?? 'plain'}`, calls.parse.mock.lastCall);
    }
    await provider.translate!({ boardId: 'board-1', baseRevision: 2, tiles: [{ id: 'tile-1', label: data, speech: data, language: 'fr-FR', targets: ['ja-JP'] }] });
    remember(`${prefix}/translate`, calls.parse.mock.lastCall);
    calls.transcribe.mockResolvedValue({ text: data });
    await provider.transcribe(Buffer.from(data), 'synthetic.wav', 'audio/wav');
    const transcription = calls.transcribe.mock.lastCall![0];
    remember(`${prefix}/transcribe`, { ...transcription, file: { name: transcription.file.name, type: transcription.file.type, bytes: Buffer.from(await transcription.file.arrayBuffer()).toString('base64') } });
    const pictures = openAIPictureProvider(env)!;
    const concept: PictureConcept = { description: data, features: [data], searchTerms: [data], emojiAccurate: false };
    calls.parse.mockResolvedValue({ status: 'completed', output_parsed: { tiles: [{ id: 'tile-1', ...concept }] } });
    await pictures.analyze({ tiles: [{ id: 'tile-1', label: data, emoji: '🐄', language: 'fr-FR', instruction: data }] });
    remember(`${prefix}/analyze`, calls.parse.mock.lastCall);
    const signal = new AbortController().signal;
    const candidates = [{ id: 'candidate-1', name: data, bytes: Buffer.from('synthetic image bytes') }];
    calls.parse.mockResolvedValue({ status: 'completed', output_parsed: { id: 'candidate-1' } });
    await pictures.select(concept, candidates, [data], signal);
    expect(calls.parse.mock.lastCall![1].signal).toBe(signal);
    remember(`${prefix}/select`, calls.parse.mock.lastCall);
    calls.generate.mockResolvedValue({ data: [{ b64_json: Buffer.from('image').toString('base64') }] });
    for (const style of ['color', 'line'] as const) {
      await pictures.generate(concept, style, signal);
      expect(calls.generate.mock.lastCall![1].signal).toBe(signal);
      remember(`${prefix}/generate/${style}`, calls.generate.mock.lastCall);
    }
    calls.parse.mockResolvedValue({ status: 'completed', output_parsed: { rejected: [] } });
    await pictures.review(candidates.map(candidate => ({ ...candidate, concept })));
    remember(`${prefix}/review`, calls.parse.mock.lastCall);
    const generate = openAISynthesis(env, speechProfile(env))!;
    for (const language of ['en-US', 'fr-FR', 'ja-JP', data]) {
      await generate({ text: 'Bonjour', language });
      remember(`${prefix}/speech/${language === data ? 'literal-boundary' : language}`, calls.send.mock.lastCall);
    }
    remember(`${prefix}/speech-profile`, speechProfile(env));
  }
  remember('client-options', calls.clients);
  remember('realtime-options', calls.connections);
  saveCapture("C:\\Users\\MChar\\Documents\\Codex\\2026-10-08\\task-9\\evidence-integration\\after\\payloads.json", JSON.stringify(payloads, null, 2) + '\n');
});

it('retains no-key and empty-picture short circuits', async () => {
  expect(openAIProvider({})).toBeNull();
  expect(openAIPictureProvider({})).toBeUndefined();
  expect(openAISynthesis({}, speechProfile({}))).toBeNull();
  calls.parse.mockClear();
  const pictures = openAIPictureProvider({ AAC_OPENAI_KEY: 'synthetic-key' })!;
  expect(await pictures.select({ description: data, features: [], searchTerms: [], emojiAccurate: false }, [], [], new AbortController().signal)).toBeNull();
  expect(await pictures.review([])).toEqual([]);
  expect(calls.parse).not.toHaveBeenCalled();
});
