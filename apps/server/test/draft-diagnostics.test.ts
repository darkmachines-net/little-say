/** @file Exercises the real OpenAI transport/parser boundary, safe failure telemetry, cancellation, and the absence of paid retries. */

import { afterEach, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { openAIProvider } from '../src/provider';
import { draftFailure, draftRequestId, type DraftMetric } from '../src/draft-diagnostics';

afterEach(() => vi.unstubAllGlobals());
const request = { prompt: 'Private name must never enter diagnostics', board: null, preparationId: randomUUID() };
const draft = { title: 'Food', explanation: 'Your cards.', needsClarification: false, playLanguages: ['en-US'], picturePolicy: { mode: 'auto', style: 'color', consistent: false }, tiles: [{ existingId: null, label: 'Apple', speech: 'Apple', language: 'en-US', languageMode: 'fixed', translations: [], emoji: '🍎', color: 'sage', pictureInstruction: '', pictureMode: null, pictureStyle: null, replacePicture: false, pictureConcept: { description: 'apple', features: [], searchTerms: ['apple'], emojiAccurate: true } }] };
function response(text = JSON.stringify(draft), status = 'completed', refusal = false) {
  return { id: 'resp_fixture', object: 'response', status, output: [{ type: 'message', role: 'assistant', content: [refusal ? { type: 'refusal', refusal: 'Private refusal text' } : { type: 'output_text', text, annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 20 } };
}

it.each([
  { name: 'upstream 503', status: 503, payload: { error: { message: request.prompt, type: 'server_error' } }, stage: 'request', category: 'provider-http' },
  { name: 'rate limit', status: 429, payload: { error: { message: request.prompt, type: 'rate_limit_error' } }, stage: 'request', category: 'provider-http' },
  { name: 'invalid JSON', status: 200, payload: response('{private bad JSON'), stage: 'json', category: 'invalid-json' },
  { name: 'invalid schema', status: 200, payload: response(JSON.stringify({ ...draft, tiles: [{ ...draft.tiles[0], pictureConcept: null }] })), stage: 'schema', category: 'schema' },
  { name: 'incomplete output', status: 200, payload: response('{partial', 'incomplete'), stage: 'response', category: 'incomplete' },
  { name: 'refusal', status: 200, payload: response('', 'completed', true), stage: 'response', category: 'refusal' },
])('classifies $name without private content or automatic retry', async ({ status, payload, stage, category }) => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_fixture' } }));
  vi.stubGlobal('fetch', fetch); const events: DraftMetric[] = [];
  await expect(openAIProvider({ OPENAI_API_KEY: 'test-key' }, event => events.push(event))!.prepare!(request, [])).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ requestId: request.preparationId, outcome: 'failure', stage, failure: { category } });
  if (status !== 200) expect(events[0].failure).toEqual({ category, status, providerRequestId: 'req_fixture' });
  else expect(events[0]).toMatchObject({ inputTokens: 10, outputTokens: 20 });
  expect(JSON.stringify(events)).not.toMatch(/Private|private|test-key|partial/);
});

it('preserves the strict draft contract and reports successful usage once', async () => {
  const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json(response())); vi.stubGlobal('fetch', fetch);
  const events: DraftMetric[] = [];
  const result = await openAIProvider({ OPENAI_API_KEY: 'test-key' }, event => events.push(event))!.prepare!(request, []);
  expect(result.tiles[0]).toMatchObject({ label: 'Apple', pictureConcept: draft.tiles[0].pictureConcept, pictureOptions: { locked: false, instruction: '' } });
  const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
  expect(body).toMatchObject({ model: 'gpt-6-luna', reasoning: { effort: 'none' }, store: false, text: { format: { strict: true, name: 'prepared_soundboard' } } });
  expect(events).toEqual([{ operation: 'draft', milliseconds: expect.any(Number), requestId: request.preparationId, outcome: 'success', inputTokens: 10, outputTokens: 20 }]);
});

it('separates transport timeout, connection, cancellation and storage errors without arbitrary messages', () => {
  expect(draftFailure(new OpenAI.APIConnectionTimeoutError())).toEqual({ category: 'timeout' });
  expect(draftFailure(new OpenAI.APIConnectionError({ message: request.prompt }))).toEqual({ category: 'connection' });
  expect(draftFailure(new Error(request.prompt), true)).toEqual({ category: 'cancelled' });
  expect(draftFailure(Object.assign(new Error(request.prompt), { code: 'EPERM', path: request.prompt }))).toEqual({ category: 'storage' });
  expect(draftFailure(new Error(request.prompt))).toEqual({ category: 'unknown' });
  expect(draftRequestId(request.prompt)).toBeUndefined();
});

it('cancels a waiting provider once without retrying or misreporting an outage', async () => {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Private abort', 'AbortError')))));
  vi.stubGlobal('fetch', fetch); const controller = new AbortController(); const events: DraftMetric[] = [];
  const work = openAIProvider({ OPENAI_API_KEY: 'test-key' }, event => events.push(event))!.prepare!(request, [], controller.signal);
  const assertion = expect(work).rejects.toThrow();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); controller.abort(); await assertion;
  expect(events[0]).toMatchObject({ stage: 'request', outcome: 'failure', failure: { category: 'cancelled' } });
  expect(fetch).toHaveBeenCalledTimes(1);
});
