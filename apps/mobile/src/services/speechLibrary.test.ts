/**
 * @file Verifies speech caching, queue priority, admission cooldowns, and obsolete job cancellation.
 */

import { starterLibrary } from '../../../../tests/fixtures/library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { speechKey, migrateLibrary, type SpeechAsset } from '@little-say/core';
import { SpeechLibrary, tileSpeech } from './speechLibrary';

const tile = starterLibrary().boards[0].tiles[0];
const clip = { id: 'a'.repeat(64), uri: 'file:///clip.wav' };
afterEach(() => vi.useRealTimers());

describe('background audio preparation', () => {
  it('reuses local audio across duplicate tiles and reloads', async () => {
    const generate = vi.fn();
    const library = new SpeechLibrary({ load: async () => ({ [speechKey(tileSpeech(tile))]: clip }), generate });
    await library.prepare([tile, { ...tile, id: 'duplicate' }], 'server');
    expect(library.asset(tile)).toEqual(clip); expect(generate).not.toHaveBeenCalled();
  });
  it('runs at most two jobs, deduplicates words, and prepares without blocking on synthesis', async () => {
    const release: ((asset: SpeechAsset) => void)[] = [];
    const generate = vi.fn(() => new Promise<SpeechAsset>(resolve => release.push(resolve)));
    const library = new SpeechLibrary({ load: async () => ({}), generate });
    const tiles = [tile, { ...tile, speech: 'Two' }, { ...tile, speech: 'Three' }, { ...tile, id: 'duplicate' }];
    await library.prepare(tiles, 'server');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(library.status(tiles[2]).state).toBe('preparing');
    release.shift()!(clip);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(3));
    release.splice(0).forEach(resolve => resolve(clip));
    await vi.waitFor(() => expect(library.status(tiles[2]).state).toBe('ready'));
  });
  it('never attaches completed audio to edited text or a different language', async () => {
    let release!: (asset: SpeechAsset) => void;
    const library = new SpeechLibrary({ load: async () => ({}), generate: () => new Promise(resolve => { release = resolve; }) });
    const pending = library.generate(tile, 'server');
    await vi.waitFor(() => expect(release).toBeDefined());
    const changed = { ...tile, speech: 'Changed' };
    release(clip); await pending;
    expect(library.asset(changed)).toBeUndefined();
    expect(library.asset({ ...tile, language: 'ru-RU' })).toBeUndefined();
    expect(library.asset(tile)).toEqual(clip);
  });
  it('preserves the prior clip on failed regeneration and permits an explicit retry', async () => {
    const generate = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ...clip, id: 'b'.repeat(64) });
    const library = new SpeechLibrary({ load: async () => ({ [speechKey(tileSpeech(tile))]: clip }), generate });
    await expect(library.generate(tile, 'server', true)).rejects.toThrow('Offline');
    await vi.waitFor(() => expect(library.status(tile).state).toBe('error'));
    expect(library.asset(tile)).toEqual(clip);
    await library.generate(tile, 'server', true);
    expect(library.asset(tile)?.id).toBe('b'.repeat(64));
  });
  it('does not replay an interrupted submission on automatic preparation', async () => {
    const generate = vi.fn().mockRejectedValueOnce(new Error('AI work could not finish')).mockResolvedValueOnce(clip);
    const library = new SpeechLibrary({ load: async () => ({}), generate });
    await library.prepare([tile], 'server');
    await vi.waitFor(() => expect(library.status(tile).state).toBe('error'));
    await library.prepare([tile], 'server'); expect(generate).toHaveBeenCalledOnce();
    await library.generate(tile, 'server');
    expect(library.status(tile).state).toBe('ready');
  });
  it('defers automatic work while offline, then submits when the browser reconnects', async () => {
    let online = false;
    const generate = vi.fn().mockResolvedValue(clip);
    const library = new SpeechLibrary({ load: async () => ({}), generate, isOnline: () => online });
    await library.prepare([tile], 'server');
    expect(generate).not.toHaveBeenCalled();
    online = true;
    await library.prepare([tile], 'server');
    await vi.waitFor(() => expect(library.status(tile).state).toBe('ready'));
    expect(generate).toHaveBeenCalledOnce();
  });
  it('shares the longest admission cooldown across the queue and resumes without a lifecycle event', async () => {
    vi.useFakeTimers();
    const short = new Error('Speech is busy');
    const long = new Error('Speech rate limit reached');
    const generate = vi.fn().mockRejectedValueOnce(short).mockRejectedValueOnce(long).mockResolvedValue(clip);
    const library = new SpeechLibrary({
      load: async () => ({}), generate,
      admissionDelay: error => error === short ? 2_000 : error === long ? 60_000 : undefined,
    });
    const tiles = [tile, { ...tile, speech: 'Two' }, { ...tile, speech: 'Three' }];
    await library.prepare(tiles, 'server');
    await vi.advanceTimersByTimeAsync(59_999);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(tiles.map(candidate => library.status(candidate).state)).toEqual(['preparing', 'preparing', 'preparing']);
    await vi.advanceTimersByTimeAsync(1);
    expect(generate).toHaveBeenCalledTimes(5);
    expect(tiles.every(candidate => library.asset(candidate)?.id === clip.id)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('backs off a backend that keeps rejecting requests across different clips', async () => {
    vi.useFakeTimers();
    const throttle = new Error('Speech is busy');
    const generate = vi.fn().mockResolvedValue(clip);
    for (let index = 0; index < 4; index++) generate.mockRejectedValueOnce(throttle);
    const library = new SpeechLibrary({
      load: async () => ({}), generate, admissionDelay: error => error === throttle ? 2_000 : undefined,
    });
    const tiles = [tile, { ...tile, speech: 'Two' }, { ...tile, speech: 'Three' }, { ...tile, speech: 'Four' }];
    await library.prepare(tiles, 'server');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(generate).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(generate).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(tiles.every(candidate => library.asset(candidate)?.id === clip.id)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('discards obsolete deferred preparation and clears its wake timer', async () => {
    vi.useFakeTimers();
    const throttle = new Error('Speech rate limit reached');
    const generate = vi.fn().mockRejectedValue(throttle);
    const library = new SpeechLibrary({
      load: async () => ({}), generate, admissionDelay: error => error === throttle ? 60_000 : undefined,
    });
    await library.prepare([tile], 'server');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    await library.prepare([], 'server');
    expect(library.status(tile).state).toBe('missing');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(generate).toHaveBeenCalledOnce();
  });
  it('discards a throttled attempt that became obsolete before the server replied', async () => {
    vi.useFakeTimers();
    const throttle = new Error('Speech rate limit reached');
    let rejectAttempt!: (error: Error) => void;
    const generate = vi.fn(() => new Promise<SpeechAsset>((_resolve, reject) => { rejectAttempt = reject; }));
    const library = new SpeechLibrary({
      load: async () => ({}), generate, admissionDelay: error => error === throttle ? 60_000 : undefined,
    });
    await library.prepare([tile], 'server');
    await library.prepare([], 'server');
    rejectAttempt(throttle);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(library.status(tile).state).toBe('missing');
    expect(generate).toHaveBeenCalledOnce();
  });
  it('loads an older library without losing boards or photos', () => {
    const older = JSON.parse(JSON.stringify(starterLibrary())); delete older.settings.autoSpeech;
    const result = migrateLibrary(older);
    expect(result.settings.autoSpeech).toBe(true); expect(result.boards).toEqual(older.boards);
  });
  it('cancels queued automatic work when disabled while retaining an explicit editor request', async () => {
    const release: ((asset: SpeechAsset) => void)[] = [];
    const generate = vi.fn(() => new Promise<SpeechAsset>(resolve => release.push(resolve)));
    const library = new SpeechLibrary({ load: async () => ({}), generate });
    const tiles = [tile, { ...tile, speech: 'Two' }, { ...tile, speech: 'Three' }, { ...tile, speech: 'Four' }];
    await library.prepare(tiles, 'server');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    const manual = library.generate(tiles[2], 'server');
    await library.prepare([], 'server');
    expect(library.status(tiles[3]).state).toBe('missing');
    release.shift()!(clip);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(3));
    release.splice(0).forEach(resolve => resolve(clip));
    await manual;
    expect(generate).toHaveBeenCalledTimes(3);
  });
});
