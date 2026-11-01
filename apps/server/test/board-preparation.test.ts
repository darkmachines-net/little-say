/** @file Verifies early word publication, generic reuse, bundled pictures, source enforcement, cancellation, and interrupted recovery. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { defaultPicturePolicy, type GeneratedBoard, type ProposalRequest } from '@little-say/core';
import { BoardPreparation, type PreparationMetric } from '../src/board-preparation';
import { GenericContent } from '../src/generic-content';
import { genericConcepts, genericConcept, canonicalPictureConcept } from '../src/generic-concepts';
import { PictureJobs } from '../src/pictures/jobs';
import { PictureScheduler } from '../src/picture-scheduler';
import { type PictureProvider } from '../src/pictures/provider';
import { createServer } from '../src/app';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const close of cleanups.splice(0).reverse()) await close(); });
const request = (prompt = 'Make six farm animal cards'): ProposalRequest => ({ preparationId: randomUUID(), prompt, board: null, pictureCapability: 1, picturePolicy: defaultPicturePolicy });
const draft = (names = ['cow', 'sheep', 'horse', 'rabbit', 'chicken animal', 'duck']): GeneratedBoard => ({ title: 'Our animals', explanation: 'Here is your board.', needsClarification: false, picturePolicy: defaultPicturePolicy, playLanguages: ['en-US'], tiles: names.map(name => {
  const item = genericConcepts.find(value => value.id === name)!;
  return { existingId: null, label: name === 'chicken animal' ? 'Chicken' : name, speech: name === 'chicken animal' ? 'Chicken' : name, language: 'en-US', languageMode: 'fixed', translations: [], emoji: item.emoji, color: 'sage', pictureConcept: { ...canonicalPictureConcept(item), features: [] }, pictureOptions: { instruction: '', locked: false } };
}) });
async function setup(board = draft(), overrides: Partial<PictureProvider> = {}, generation = true, metric?: (event: PreparationMetric) => void) {
  const root = await mkdtemp(join(tmpdir(), 'little-say-preparation-'));
  const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ff7700' } }).png().toBuffer();
  const picturesProvider: PictureProvider = { model: 'test', analyze: vi.fn(), review: vi.fn(async () => []), select: vi.fn(async () => null), selectBatch: vi.fn(async (cards: Parameters<NonNullable<PictureProvider['selectBatch']>>[0]) => cards.map(card => ({ id: card.id, candidate: null }))), generate: vi.fn(async () => png), validate: vi.fn(async () => true), ...overrides };
  const provider = { propose: vi.fn(async () => structuredClone(board)), prepare: vi.fn(async (_request: ProposalRequest, _templates: GeneratedBoard[] = []) => structuredClone(board)) };
  const pictures = new PictureJobs(join(root, 'pictures'), picturesProvider, generation);
  vi.spyOn(pictures, 'generatedSeed').mockResolvedValue(null);
  const content = new GenericContent(join(root, 'generic'));
  const batches = join(root, 'batches');
  const preparation = new BoardPreparation(batches, provider, pictures, content, undefined, 6, metric);
  await preparation.status('none'); await pictures.status('none'); await content.related(request());
  cleanups.push(async () => { preparation.close(); pictures.close(); await new Promise(resolve => setTimeout(resolve, 30)); await rm(root, { recursive: true, force: true }); });
  return { root, batches, preparation, pictures, provider, picturesProvider, content, png };
}
async function finished(service: BoardPreparation, id: string) {
  await vi.waitFor(async () => expect((await service.status(id))?.state).not.toBe('working'));
  return (await service.status(id))!;
}

describe('fast preparation', () => {
  it('publishes detached validated words and a pollable batch before any picture lookup', async () => {
    const { preparation, pictures } = await setup(draft(['cow']));
    const seed = vi.spyOn(pictures, 'seed');
    const input = request();
    const published = vi.fn(async (preview: Awaited<ReturnType<BoardPreparation['propose']>>) => {
      expect(seed).not.toHaveBeenCalled();
      expect(preview.proposal.tiles[0].label).toBe('cow');
      expect(preview.pictures).toEqual([]);
      expect(preview.preparation).toEqual(await preparation.status(input.preparationId!));
      expect(preview.preparation!.tiles).toEqual([{ index: 0, state: 'finding' }]);
    });
    const completed = await preparation.propose(input, published);
    expect(published).toHaveBeenCalledOnce();
    expect(completed.preparation!.tiles[0].state).toBe('ready');
    expect(published.mock.calls[0][0].preparation!.tiles[0].state).toBe('finding');
  });
  it('cancels from the word preview before starting picture work', async () => {
    const { preparation, pictures, picturesProvider } = await setup(draft(['cow']));
    const seed = vi.spyOn(pictures, 'seed');
    const input = request();
    await expect(preparation.propose(input, async () => { await preparation.cancel(input.preparationId!); })).rejects.toThrow();
    expect((await preparation.status(input.preparationId!))!.state).toBe('cancelled');
    expect(seed).not.toHaveBeenCalled(); expect(picturesProvider.generate).not.toHaveBeenCalled();
  });
  it('does not publish a board for clarification or invalid model output', async () => {
    const { preparation, provider } = await setup();
    const publish = vi.fn();
    provider.prepare.mockResolvedValueOnce({ ...draft(), needsClarification: true, tiles: [] });
    expect((await preparation.propose(request(), publish)).proposal.needsClarification).toBe(true);
    provider.prepare.mockResolvedValueOnce({ ...draft(), title: '' });
    await expect(preparation.propose(request(), publish)).rejects.toThrow();
    expect(publish).not.toHaveBeenCalled();
  });
  it('distinguishes drafting from downstream validation failures and never replays a failed request ID', async () => {
    const events: PreparationMetric[] = [];
    const { preparation, provider, picturesProvider } = await setup(draft(), {}, true, event => events.push(event));
    const first = request(); provider.prepare.mockRejectedValueOnce(new SyntaxError('private model output'));
    await expect(preparation.propose(first)).rejects.toThrow();
    await expect(preparation.propose(first)).rejects.toThrow();
    expect(provider.prepare).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ operation: 'preparation-failed', requestId: first.preparationId, stage: 'draft', failure: { category: 'invalid-json' } });
    provider.prepare.mockResolvedValueOnce({ ...draft(), title: '' });
    const second = request(); await expect(preparation.propose(second)).rejects.toThrow();
    expect(events.at(-1)).toMatchObject({ operation: 'preparation-failed', requestId: second.preparationId, stage: 'validate' });
    expect(picturesProvider.generate).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).not.toContain('private');
  });
  it('returns six verified bundled pictures offline, then reuses the generic template across requests', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Offline'); }));
    const { preparation, pictures, provider, picturesProvider, content, root } = await setup();
    const first = await preparation.propose(request());
    expect(first.preparation?.tiles.every(tile => tile.state === 'ready')).toBe(true);
    expect(first.pictures).toHaveLength(6);
    for (const picture of first.pictures!) if (picture.illustration.kind === 'library') expect(await pictures.read(picture.illustration.assetId)).not.toBeNull();
    const second = await preparation.propose(request());
    expect(second.timing?.templateHit).toBe(true);
    expect(provider.prepare).toHaveBeenCalledTimes(1);
    expect(picturesProvider.selectBatch).not.toHaveBeenCalled(); expect(picturesProvider.generate).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(second.boardId).toBeNull(); expect(second.proposal.tiles.every(tile => tile.existingId === null)).toBe(true);
    expect(second.preparation!.id).not.toBe(first.preparation!.id);
    expect((await content.exact(request()))?.pictures).toHaveLength(6);
    const restored = new GenericContent(join(root, 'generic'));
    expect((await restored.exact(request()))?.pictures).toHaveLength(6);
  });
  it('does not persist personal requests, titles, names, or instructions in the generic index', async () => {
    const board = draft(['cow']); board.title = 'Sophie private board'; board.tiles[0].speech = 'Sophie';
    const { preparation, root, content } = await setup(board);
    const input = request('Make a cow card for Sophie'); await preparation.propose(input);
    expect(await content.exact(input)).toBeUndefined();
    const files = await readdir(join(root, 'generic'));
    const stored = (await Promise.all(files.map(file => readFile(join(root, 'generic', file), 'utf8')))).join('');
    expect(stored).not.toContain('Sophie'); expect(stored).not.toContain('private');
    expect(genericConcept({ ...canonicalPictureConcept(genericConcepts[0]), features: ['Sophie'] })).toBeUndefined();
    expect(genericConcept(canonicalPictureConcept(genericConcepts[0]), 'Sophie pet')).toBeUndefined();
  });
  it('serves distinct bundled construction results offline without new paid generation', async () => {
    const board = draft(['dump truck', 'concrete mixer truck', 'excavator', 'bulldozer', 'crane truck', 'road roller']);
    const { preparation, pictures, picturesProvider } = await setup(board);
    vi.mocked(pictures.generatedSeed).mockRestore();
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Offline'); }));
    const result = await preparation.propose(request('Make six construction vehicle cards'));
    expect(result.preparation!.state).toBe('complete');
    expect(new Set(result.pictures!.map(tile => 'assetId' in tile.illustration ? tile.illustration.assetId : '')).size).toBe(6);
    expect(picturesProvider.generate).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('does not apply exact templates to extra constraints or changed language profiles', async () => {
    const { preparation, provider, content } = await setup();
    await preparation.propose(request());
    expect(await content.exact({ ...request(), languageProfile: { defaultLanguage: 'fr-FR', languages: ['fr-FR'] } })).toBeUndefined();
    await preparation.propose(request('Make six farm animal cards and include a goat'));
    expect(provider.prepare).toHaveBeenCalledTimes(2);
    expect(provider.prepare.mock.calls[1][1]).toHaveLength(1);
  });
  it('preserves sense distinctions and shares pictures across labels and unrelated neighbors', async () => {
    const { preparation } = await setup(draft(['chicken animal', 'chicken food', 'bat animal']));
    const result = await preparation.propose(request('Make chicken animal chicken food bat animal cards'));
    expect(new Set(result.pictures!.map(tile => 'assetId' in tile.illustration ? tile.illustration.assetId : '')).size).toBe(3);
    expect(genericConcept({ description: 'baseball bat', features: [], searchTerms: ['bat'], emojiAccurate: false })).toBeUndefined();
  });
  it('requires an established sense for ambiguous words shared between languages', async () => {
    for (const description of ['chat', 'pain', 'pan']) expect(genericConcept({ description, features: [], searchTerms: [description], emojiAccurate: false })).toBeUndefined();
    const { content } = await setup(); const board = draft(['bread']);
    board.tiles[0].label = 'Pain'; board.tiles[0].speech = 'Pain';
    const input = request('Make a bread card'); await content.remember(input, board);
    expect(await content.exact(input)).toBeUndefined();
    board.tiles[0].language = 'fr-FR'; board.playLanguages = ['fr-FR']; await content.remember(input, board);
    expect((await content.exact(input))?.board.tiles[0].label).toBe('Pain');
  });
  it('never generates in library or emoji mode, and marks unsuitable fallbacks honestly', async () => {
    const board = draft(['excavator', 'bulldozer']); board.picturePolicy = { ...defaultPicturePolicy, mode: 'library' };
    const { preparation, pictures, picturesProvider } = await setup(board);
    vi.spyOn(pictures, 'library').mockRejectedValue(new Error('Offline'));
    const result = await preparation.propose(request('Make excavator bulldozer cards'));
    const batch = await finished(preparation, result.preparation!.id);
    expect(batch.tiles.every(tile => tile.state === 'fallback')).toBe(true); expect(picturesProvider.generate).not.toHaveBeenCalled();
  });
  it('uses aggregate generation once and rejects changed-payload IDs and pre-response cancellation', async () => {
    const board = draft(['excavator']); board.picturePolicy = { ...defaultPicturePolicy, mode: 'generated' };
    const { preparation, picturesProvider } = await setup(board);
    const input = request('Make an excavator card');
    const first = await preparation.propose(input); await finished(preparation, first.preparation!.id);
    await preparation.propose(input); expect(picturesProvider.generate).toHaveBeenCalledTimes(1);
    await expect(preparation.propose({ ...input, prompt: 'Make a cow card' })).rejects.toThrow('already used');
    const cancelled = request(); await preparation.cancel(cancelled.preparationId!);
    await expect(preparation.propose(cancelled)).rejects.toThrow('cancelled');
  });
  it('does not regenerate rejected pictures and does not reuse their fallback board', async () => {
    const board = draft(['excavator']); board.picturePolicy = { ...defaultPicturePolicy, mode: 'generated' };
    const { preparation, picturesProvider, content } = await setup(board, { validate: vi.fn(async () => false) });
    const input = request('Make an excavator card'); const result = await preparation.propose(input);
    expect((await finished(preparation, result.preparation!.id)).tiles[0].state).toBe('fallback');
    expect(picturesProvider.generate).toHaveBeenCalledTimes(1); expect(await content.exact(input)).toBeUndefined();
  });
  it('reuses private draft pictures only within a matching refinement and respects explicit regeneration', async () => {
    const board = draft(['excavator']); board.picturePolicy = { ...defaultPicturePolicy, mode: 'generated' };
    board.tiles[0].pictureOptions!.instruction = 'A purple excavator';
    const { preparation, picturesProvider, provider } = await setup(board);
    const first = await preparation.propose(request('My purple excavator'));
    const initial = await finished(preparation, first.preparation!.id);
    const revised = structuredClone(board); revised.tiles[0].label = 'My digger'; provider.prepare.mockResolvedValue(revised);
    const next = await preparation.propose({ ...request('Shorten the label'), previousPreparationId: first.preparation!.id, conversation: { history: [], draft: first.proposal } });
    expect(next.preparation!.tiles[0].result).toEqual(initial.tiles[0].result);
    expect(picturesProvider.generate).toHaveBeenCalledOnce();
    revised.tiles[0].replacePicture = true;
    const replacement = await preparation.propose({ ...request('Draw it again'), previousPreparationId: next.preparation!.id, conversation: { history: [], draft: next.proposal } });
    await finished(preparation, replacement.preparation!.id);
    expect(picturesProvider.generate).toHaveBeenCalledTimes(2);
    expect(picturesProvider.generate).toHaveBeenLastCalledWith(expect.objectContaining({ features: expect.arrayContaining(['Picture requirement: A purple excavator']) }), 'color', expect.any(AbortSignal));
  });
  it('keeps line art separate from color reuse and bypasses shared cache for regeneration', async () => {
    const board = draft(['excavator']); board.picturePolicy = { ...defaultPicturePolicy, mode: 'generated', style: 'line' };
    const { preparation, provider, picturesProvider } = await setup(board);
    const first = await preparation.propose(request('Make an excavator card')); await finished(preparation, first.preparation!.id);
    expect(picturesProvider.generate).toHaveBeenLastCalledWith(expect.anything(), 'line', expect.any(AbortSignal));
    const next = structuredClone(board); next.tiles[0].replacePicture = true; provider.prepare.mockResolvedValue(next);
    const second = await preparation.propose(request('Draw another excavator')); await finished(preparation, second.preparation!.id);
    expect(picturesProvider.generate).toHaveBeenCalledTimes(2);
    next.tiles[0].replacePicture = false; next.picturePolicy!.style = 'color';
    const third = await preparation.propose(request('Make a color excavator')); await finished(preparation, third.preparation!.id);
    expect(picturesProvider.generate).toHaveBeenLastCalledWith(expect.anything(), 'color', expect.any(AbortSignal));
  });
  it('recovers interrupted batches without paid replay and repairs corrupt bundled assets', async () => {
    const { preparation, batches, pictures, provider, picturesProvider, content, root } = await setup(draft(['cow']));
    const id = randomUUID();
    await writeFile(join(batches, `batch-${id}.json`), JSON.stringify({ fingerprint: 'interrupted', batch: { id, state: 'working', tiles: [{ index: 0, state: 'generating' }] } }));
    const restored = new BoardPreparation(batches, provider, pictures, content);
    expect(await restored.status(id)).toMatchObject({ state: 'error', tiles: [{ state: 'fallback' }] }); restored.close();
    expect(picturesProvider.generate).not.toHaveBeenCalled();
    const first = await preparation.propose(request('Make a cow card'));
    const picture = first.preparation!.tiles[0].result!;
    if (picture.kind === 'unresolved') throw new Error('Expected a picture');
    await writeFile(join(root, 'pictures', `${picture.assetId}.png`), 'corrupt');
    const second = await preparation.propose(request('Make a cow card'));
    expect(second.preparation!.tiles[0].state).toBe('ready'); expect(await pictures.read(picture.assetId)).not.toBeNull();
    expect(picturesProvider.generate).not.toHaveBeenCalled();
  });
  it('negotiates without changing legacy health or legacy proposal responses', async () => {
    const { preparation, provider, pictures } = await setup();
    const app = await createServer({ preparation, provider, pictures });
    try {
      expect((await app.inject('/api/health')).json()).toMatchObject({ preparation: { version: 1 }, pictures: { version: 1 } });
      const input = request();
      const fast = (await app.inject({ method: 'POST', url: '/api/boards/propose', headers: { 'x-little-say': '1' }, payload: input })).json();
      expect(fast.preparation.state).toBe('complete');
      const { preparationId: _id, ...legacy } = input;
      expect((await app.inject({ method: 'POST', url: '/api/boards/propose', headers: { 'x-little-say': '1' }, payload: legacy })).json().preparation).toBeUndefined();
      expect(provider.propose).toHaveBeenCalledOnce();
    } finally { await app.close(); }
  });
});

describe('fair shared generation', () => {
  it('keeps shared work alive for another subscriber and aborts when the last leaves', async () => {
    const scheduler = new PictureScheduler(1); const a = new AbortController(), b = new AbortController();
    let release!: (value: number) => void; let shared!: AbortSignal;
    const run = vi.fn((signal: AbortSignal) => { shared = signal; return new Promise<number>(resolve => { release = resolve; }); });
    const first = scheduler.subscribe('cow', 'a', a.signal, run).catch(error => error.message);
    const second = scheduler.subscribe('cow', 'b', b.signal, run);
    a.abort(); expect(await first).toBe('Cancelled'); expect(shared.aborted).toBe(false);
    release(4); expect(await second).toBe(4); expect(run).toHaveBeenCalledOnce(); scheduler.close();
  });
  it('admits six simultaneous requests, bounds the backlog, and services another board before another wave', async () => {
    const scheduler = new PictureScheduler(6, 2); const signal = new AbortController().signal;
    const order: string[] = []; const releases: (() => void)[] = [];
    const submit = (key: string, board: string) => scheduler.subscribe(key, board, signal, async () => { order.push(key); await new Promise<void>(resolve => releases.push(resolve)); return key; });
    const jobs = Array.from({ length: 6 }, (_, i) => submit(String(i), 'a'));
    jobs.push(submit('a-later', 'a'), submit('b-first', 'b'));
    await expect(submit('overflow', 'c')).rejects.toThrow('busy');
    expect(order).toHaveLength(6); releases[0](); await vi.waitFor(() => expect(order[6]).toBe('b-first'));
    releases.slice(1).forEach(release => release()); await vi.waitFor(() => expect(order).toHaveLength(8)); releases.at(-1)!();
    await Promise.all(jobs); scheduler.close();
  });
});
