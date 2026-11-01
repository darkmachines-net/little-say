/** @file Verifies early word previews, independent verified picture publication, honest readiness, source enforcement, and cancellation. */

import { beforeEach, expect, it, vi } from 'vitest';
import { type BoardProposal, defaultPicturePolicy } from '@little-say/core';
import { starterLibrary } from '../../../../tests/fixtures/library';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn(), speech: vi.fn() }));
vi.mock('./api', () => ({ apiFetch: mocks.fetch, backendUrl: (value: string) => value }));
vi.mock('../data/storage', () => ({ savePictureAsset: mocks.save, saveSpeechAsset: mocks.speech }));
import { prepareServerPictures } from './preparedPictures';

const id = '10000000-0000-4000-8000-000000000001';
const picture = { kind: 'generated' as const, assetId: 'a'.repeat(64), style: 'color' as const, description: 'cow', model: 'test' };
const envelope = (): BoardProposal => ({ boardId: null, baseRevision: null, proposal: { title: 'Animals', explanation: 'Here are animals.', needsClarification: false, picturePolicy: defaultPicturePolicy, tiles: [{ existingId: null, label: 'Cow', speech: 'Cow', language: 'en-US', color: 'sage', emoji: '🐄', pictureConcept: { description: 'cow', features: [], searchTerms: ['cow'], emojiAccurate: true } }] }, preparation: { id, state: 'complete', tiles: [{ index: 0, state: 'ready', result: picture }] } });
beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue(undefined); mocks.fetch.mockResolvedValue({}); });

it('publishes usable words immediately and only installs assets after their bytes are verified locally', async () => {
  let release!: () => void; mocks.save.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const preview = vi.fn(), available = vi.fn(), progress = vi.fn(), tileProgress = vi.fn();
  const work = prepareServerPictures(undefined, envelope(), starterLibrary().settings, { preview, available, progress, tileProgress });
  await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
  expect(preview).toHaveBeenCalledOnce(); expect(available).toHaveBeenCalledOnce();
  expect(preview.mock.calls[0][0].tiles[0]).toMatchObject({ label: 'Cow', illustration: { kind: 'emoji' } });
  expect(progress).toHaveBeenLastCalledWith('Loading pictures · 0 of 1 ready');
  expect(tileProgress).toHaveBeenLastCalledWith('draft-1', 'loading');
  release(); const result = await work;
  expect(available).toHaveBeenCalledOnce(); expect(result.proposal.pictures![0].illustration).toEqual(picture);
  expect(progress).toHaveBeenLastCalledWith('Pictures prepared · 1 of 1 ready');
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it('fills each downloaded picture without waiting for a slower card and keeps tile identities stable', async () => {
  const input = envelope();
  input.proposal.tiles.push({ ...input.proposal.tiles[0], label: 'Sheep' });
  const sheep = { ...picture, assetId: 'b'.repeat(64) };
  input.preparation!.tiles.push({ index: 1, state: 'ready', result: sheep });
  const releases = new Map<string, () => void>();
  mocks.save.mockImplementation((id: string) => new Promise<void>(resolve => { releases.set(id, resolve); }));
  const preview = vi.fn(), progress = vi.fn();
  const work = prepareServerPictures(undefined, input, starterLibrary().settings, { preview, progress });
  await vi.waitFor(() => expect(releases.size).toBe(2));
  const ids = preview.mock.calls[0][0].tiles.map((tile: { id: string }) => tile.id);
  releases.get(sheep.assetId)!();
  await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith('Loading pictures · 1 of 2 ready'));
  expect(preview.mock.lastCall![0].tiles.map((tile: { illustration: { kind: string } }) => tile.illustration.kind)).toEqual(['emoji', 'generated']);
  expect(preview.mock.lastCall![0].tiles.map((tile: { id: string }) => tile.id)).toEqual(ids);
  releases.get(picture.assetId)!(); await work;
});

it('keeps the initial words and ignores a late download after cancellation', async () => {
  let release!: () => void;
  mocks.save.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const controller = new AbortController(), preview = vi.fn();
  const work = prepareServerPictures(undefined, envelope(), starterLibrary().settings, { signal: controller.signal, preview });
  const assertion = expect(work).rejects.toThrow('stopped');
  await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
  controller.abort(); release(); await assertion;
  expect(preview).toHaveBeenCalledOnce();
  expect(preview.mock.calls[0][0].tiles[0].illustration.kind).toBe('emoji');
});

it('reports failed downloads as kept fallbacks rather than ready pictures', async () => {
  mocks.save.mockRejectedValue(new Error('Offline'));
  const progress = vi.fn();
  const result = await prepareServerPictures(undefined, envelope(), starterLibrary().settings, { progress });
  expect(progress).toHaveBeenLastCalledWith('Pictures prepared · 0 of 1 ready · 1 kept');
  expect(result.proposal.pictures![0].illustration.kind).toBe('emoji');
  expect(result.issues).toHaveLength(1);
});

it('keeps the last visible preview stable and cancels its batch when saved during generation', async () => {
  const input = envelope(); input.preparation = { id, state: 'working', tiles: [{ index: 0, state: 'generating' }] };
  const controller = new AbortController(); const previews: unknown[] = [];
  const work = prepareServerPictures(undefined, input, starterLibrary().settings, { signal: controller.signal, preview: value => previews.push(value), available: () => controller.abort() });
  await expect(work).rejects.toThrow('stopped');
  expect(previews).toHaveLength(1); expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.fetch.mock.calls.some(call => call[1] === `/api/pictures/batches/${id}/cancel`)).toBe(true);
});

it('never installs generated pictures for library-only requests or missing downloads', async () => {
  const input = envelope(); input.proposal.picturePolicy = { ...defaultPicturePolicy, mode: 'library' };
  const result = await prepareServerPictures(undefined, input, starterLibrary().settings, {});
  expect(mocks.save).not.toHaveBeenCalled(); expect(result.proposal.pictures![0].illustration.kind).toBe('emoji'); expect(result.issues).toHaveLength(1);
});

it('rejects duplicate indices and results from another batch', async () => {
  const input = envelope(); input.preparation!.tiles.push(input.preparation!.tiles[0]);
  await expect(prepareServerPictures(undefined, input, starterLibrary().settings, {})).rejects.toThrow('Invalid picture batch');
  expect(mocks.save).not.toHaveBeenCalled();
});

it('keeps the visible photo when a requested replacement fails', async () => {
  const source = starterLibrary().boards[0];
  source.tiles[0].illustration = { kind: 'photo', assetId: 'private-photo', zoom: 1, x: 0, y: 0 };
  const input = envelope(); input.boardId = source.id; input.baseRevision = source.revision;
  input.proposal.tiles[0].existingId = source.tiles[0].id; input.proposal.tiles[0].replacePicture = true;
  input.preparation!.tiles[0] = { index: 0, state: 'fallback' };
  const result = await prepareServerPictures(source, input, starterLibrary().settings, {});
  expect(result.proposal.pictures![0].illustration).toEqual(source.tiles[0].illustration);
  expect(result.issues).toHaveLength(1);
});

it('retains a verified unsaved picture through a wording-only refinement', async () => {
  const previous = envelope(); previous.pictures = [{ index: 0, illustration: picture, concept: previous.proposal.tiles[0].pictureConcept }];
  const input = envelope(); input.proposal.tiles[0].label = 'A cow'; input.preparation!.tiles[0] = { index: 0, state: 'fallback' };
  const result = await prepareServerPictures(undefined, input, starterLibrary().settings, {}, previous);
  expect(result.proposal.pictures![0].illustration).toEqual(picture);
  expect(mocks.save).not.toHaveBeenCalled();
});

it('rejects server pictures that violate explicit line-art presentation', async () => {
  const input = envelope(); input.proposal.picturePolicy = { ...defaultPicturePolicy, style: 'line' };
  const result = await prepareServerPictures(undefined, input, starterLibrary().settings, {});
  expect(mocks.save).not.toHaveBeenCalled(); expect(result.issues).toHaveLength(1);
});
