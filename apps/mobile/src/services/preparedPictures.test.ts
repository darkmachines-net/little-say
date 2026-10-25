/** @file Verifies verified-before-save publication, aggregate polling, source enforcement, and cancellation of prepared board pictures. */

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

it('only publishes a saveable asset after its bytes have been verified locally', async () => {
  let release!: () => void; mocks.save.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const preview = vi.fn(), available = vi.fn();
  const work = prepareServerPictures(undefined, envelope(), starterLibrary().settings, { preview, available });
  await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
  expect(preview).not.toHaveBeenCalled(); expect(available).not.toHaveBeenCalled();
  release(); const result = await work;
  expect(available).toHaveBeenCalledOnce(); expect(result.proposal.pictures![0].illustration).toEqual(picture);
  expect(mocks.fetch).not.toHaveBeenCalled();
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
