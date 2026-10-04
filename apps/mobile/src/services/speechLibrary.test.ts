import { describe, expect, it, vi } from 'vitest';
import { speechKey, starterLibrary, migrateLibrary, type SpeechAsset } from '@little-say/core';
import { SpeechLibrary, tileSpeech } from './speechLibrary';

const tile = starterLibrary().boards[0].tiles[0];
const clip = { id: 'a'.repeat(64), uri: 'file:///clip.wav' };
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
  it('does not loop on an offline server but retries when connectivity returns', async () => {
    const generate = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(clip);
    const library = new SpeechLibrary({ load: async () => ({}), generate });
    await library.prepare([tile], 'server');
    await vi.waitFor(() => expect(library.status(tile).state).toBe('error'));
    await library.prepare([tile], 'server'); expect(generate).toHaveBeenCalledOnce();
    await library.prepare([tile], 'server', true);
    await vi.waitFor(() => expect(library.status(tile).state).toBe('ready'));
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
