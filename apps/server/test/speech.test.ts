/**
 * @file Verifies synthesis transcript checks, WAV encoding, durable cache behavior, and speech API
 * responses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpeechCache } from '../src/speech-cache';
import { pcmToWav, speechProfile, transcriptMatches } from '../src/synthesis';
import { createServer } from '../src/app';

let directory: string;
const profile = speechProfile({});
const input = { text: 'Cow', language: 'en-US' };
const wav = (value = 0) => pcmToWav(Buffer.alloc(100, value));
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'little-say-speech-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('durable speech cache', () => {
  it('deduplicates simultaneous requests and persists reuse across restart without an API key', async () => {
    const generate = vi.fn(async () => wav());
    const cache = new SpeechCache(directory, profile, generate);
    const [first, second] = await Promise.all([cache.get(input), cache.get(input)]);
    expect(first.id).toBe(second.id); expect(generate).toHaveBeenCalledOnce();
    const restarted = new SpeechCache(directory, profile, null);
    expect(await restarted.get({ text: ' Cow ', language: 'en-us' })).toEqual({ id: first.id, cacheHit: true });
    expect(await restarted.read(first.id)).toEqual(wav());
  });
  it('separates language, exact words, voice, model, and instruction versions', async () => {
    const generate = vi.fn(async () => wav());
    const cache = new SpeechCache(directory, profile, generate);
    await cache.get(input);
    await cache.get({ ...input, language: 'fr-FR' });
    await cache.get({ ...input, text: 'cow' });
    for (const change of [{ voice: 'cedar' }, { model: 'another-model' }, { version: 2 }]) {
      await new SpeechCache(directory, { ...profile, ...change }, generate).get(input);
    }
    expect(generate).toHaveBeenCalledTimes(6);
  });
  it('regenerates a fresh take without invalidating the previous immutable audio URL', async () => {
    const generate = vi.fn().mockResolvedValueOnce(wav()).mockResolvedValueOnce(wav(1));
    const cache = new SpeechCache(directory, profile, generate);
    const old = await cache.get(input);
    const fresh = await cache.get(input, true);
    expect(fresh.id).not.toBe(old.id); expect(fresh.cacheHit).toBe(false);
    expect(await cache.get(input)).toEqual({ id: fresh.id, cacheHit: true });
    expect(await cache.read(old.id)).toEqual(wav());
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('keeps the old cache after failed regeneration and clears the in-flight entry', async () => {
    const generate = vi.fn().mockResolvedValueOnce(wav()).mockRejectedValueOnce(new Error('private provider details')).mockResolvedValueOnce(wav(1));
    const cache = new SpeechCache(directory, profile, generate);
    const old = await cache.get(input);
    await expect(cache.get(input, true)).rejects.toThrow();
    expect((await cache.get(input)).id).toBe(old.id);
    expect((await cache.get(input, true)).id).not.toBe(old.id);
  });
  it('bounds concurrent generation while allowing cache hits', async () => {
    let release!: (audio: Buffer) => void;
    const generate = vi.fn(async () => wav());
    const cache = new SpeechCache(directory, profile, generate, 1);
    const old = await cache.get(input);
    generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = cache.get({ ...input, text: 'Sheep' });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect((await cache.get(input)).id).toBe(old.id);
    await expect(cache.get({ ...input, text: 'Horse' })).rejects.toMatchObject({ statusCode: 429 });
    release(wav()); await pending;
    await expect(cache.get({ ...input, text: 'Horse' })).resolves.toHaveProperty('id');
  });
  it('does not cache invalid output and rejects path traversal', async () => {
    const cache = new SpeechCache(directory, profile, vi.fn(async () => Buffer.from('<html>Not audio</html>')));
    await expect(cache.get(input)).rejects.toThrow('Invalid generated audio');
    expect(await cache.read('../../secret')).toBeNull();
  });
});

describe('speech API', () => {
  it('validates input, serves playable immutable audio, and sanitizes provider failures', async () => {
    const generate = vi.fn(async () => wav());
    const app = await createServer({ provider: null, speechCache: new SpeechCache(directory, profile, generate) });
    const post = (payload: unknown, headers = { 'x-little-say': '1' }) => app.inject({ method: 'POST', url: '/api/speech', payload: payload as object, headers });
    try {
      expect((await post(input, { 'x-little-say': '0' })).statusCode).toBe(403);
      for (const payload of [{ ...input, text: '' }, { ...input, text: 'x'.repeat(201) }, { ...input, language: '../../en' }]) expect((await post(payload)).statusCode).toBe(400);
      expect(generate).not.toHaveBeenCalled();
      const response = await post(input); expect(response.statusCode).toBe(200);
      const audio = await app.inject(`/api/speech/${response.json().id}.wav`);
      expect(audio.rawPayload).toEqual(wav()); expect(audio.headers['content-type']).toBe('audio/wav');
      expect(audio.headers['cache-control']).toContain('immutable');
      expect((await app.inject('/api/speech/invalid.wav')).statusCode).toBe(404);
      generate.mockRejectedValueOnce(new Error('private text and API key'));
      const failure = await post({ ...input, regenerate: true });
      expect(failure.statusCode).toBe(502); expect(failure.body).not.toContain('private text');
      expect((await post(input)).json().cacheHit).toBe(true);
    } finally { await app.close(); }
  });
});

it('checks generated words without rejecting casing or punctuation, and makes valid WAV headers', () => {
  expect(transcriptMatches('бабушка', 'Бабушка.')).toBe(true);
  expect(transcriptMatches('Cow', 'Here is the word cow.')).toBe(false);
  expect(transcriptMatches('Cow', 'Sheep')).toBe(false);
  expect(transcriptMatches('...', '...')).toBe(false);
  const audio = wav();
  expect(audio.readUInt32LE(24)).toBe(24000); expect(audio.readUInt32LE(40)).toBe(100);
  expect(() => pcmToWav(Buffer.alloc(1))).toThrow();
  expect(() => pcmToWav(Buffer.alloc(1000000))).toThrow();
});
