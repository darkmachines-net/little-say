/** @file Verifies client picture permission enforcement, protected-card retention, failure rollback, and draft identity checks. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { starterLibrary } from '../../../../tests/fixtures/library';
import { defaultPicturePolicy, type Board, type Settings } from '@little-say/core';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn() }));
vi.mock('./api', () => ({ apiFetch: mocks.fetch, backendUrl: () => 'https://private.example' }));
vi.mock('../data/storage', () => ({ savePictureAsset: mocks.save }));
vi.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
import { prepareBoardPictures, prepareProposalPictures } from './pictures';

let board: Board; let settings: Settings;
beforeEach(() => {
  board = { ...starterLibrary().boards[0], picturePolicy: defaultPicturePolicy, tiles: starterLibrary().boards[0].tiles.slice(0, 2) };
  settings = { ...starterLibrary().settings, aiConsent: true, autoImages: false };
  mocks.save.mockReset(); mocks.save.mockResolvedValue(undefined);
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async (_server: string, path: string, init: RequestInit) => {
    const input = JSON.parse(String(init.body));
    if (path.endsWith('/analyze')) return { tiles: input.tiles.map((tile: any) => ({ id: tile.id, emoji: tile.emoji || '🐄', concept: { description: tile.label, searchTerms: [tile.label], features: [], emojiAccurate: false } })) };
    if (path.endsWith('/review')) return { rejected: [] };
    if (path.endsWith('/jobs')) return { id: input.requestId, draftId: input.draftId, tileId: input.tileId, state: 'complete', result: { kind: 'generated', assetId: 'a'.repeat(64), style: input.style, description: input.concept.description, model: 'test' } };
    throw new Error('Unexpected request');
  });
});
describe('staged client pictures', () => {
  it('does not accept a generated result when image generation was not permitted', async () => {
    const result = await prepareBoardPictures(board, settings);
    expect(result.board.tiles.every(tile => tile.illustration.kind === 'unresolved')).toBe(true);
    expect(result.issues.join(' ')).toContain('permission'); expect(mocks.save).not.toHaveBeenCalled();
    expect(board.tiles.every(tile => tile.illustration.kind === 'emoji')).toBe(true);
  });
  it('preserves a saved picture after a failed replacement download', async () => {
    board.tiles[0].illustration = { kind: 'generated', assetId: 'b'.repeat(64), style: 'color', description: 'cow', model: 'test' };
    mocks.save.mockRejectedValue(new Error('Storage full'));
    const result = await prepareBoardPictures(board, settings, { restyle: true, allowGeneration: true });
    expect(result.board.tiles[0].illustration).toEqual(board.tiles[0].illustration);
    expect(result.issues.join(' ')).toContain('Storage full');
  });
  it('does not send photos or protected picture assets in matching requests', async () => {
    board.tiles[0].illustration = { kind: 'photo', assetId: 'private-path', zoom: 1, x: 0, y: 0 };
    board.tiles[0].pictureOptions = { locked: true, instruction: '' };
    const result = await prepareBoardPictures(board, settings, { allowGeneration: true });
    expect(result.board.tiles[0].illustration).toEqual(board.tiles[0].illustration);
    expect(JSON.stringify(mocks.fetch.mock.calls)).not.toContain('private-path');
    expect(mocks.fetch.mock.calls.filter(call => call[1].endsWith('/jobs'))).toHaveLength(1);
  });
  it('rejects a picture response belonging to another draft before downloading it', async () => {
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (...args: any[]) => { const result = await original(...args); return args[1].endsWith('/jobs') ? { ...result, draftId: 'stale-draft' } : result; });
    const result = await prepareBoardPictures(board, settings, { allowGeneration: true });
    expect(result.issues.join(' ')).toContain('older draft'); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('restores a photo when its explicitly requested replacement fails the final visual review', async () => {
    const photo = { kind: 'photo' as const, assetId: 'private-photo', zoom: 1, x: 0, y: 0 };
    board.tiles[0].illustration = photo;
    board.tiles[0].pictureOptions = { locked: true, instruction: '' };
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (...args: any[]) => args[1].endsWith('/review') ? { rejected: [board.tiles[0].id] } : original(...args));
    const result = await prepareBoardPictures(board, settings, { targetIds: new Set([board.tiles[0].id]), replaceProtected: true, restyle: true, allowGeneration: true });
    expect(result.board.tiles[0].illustration).toEqual(photo);
    expect(result.issues.join(' ')).toContain('hard to distinguish');
    expect(JSON.stringify(mocks.fetch.mock.calls)).not.toContain('private-photo');
  });
  it('changes only explicitly requested pictures in a saved AI board', async () => {
    const envelope = { boardId: board.id, baseRevision: board.revision, proposal: { title: 'Renamed', explanation: 'Renamed.', needsClarification: false, picturePolicy: defaultPicturePolicy, tiles: board.tiles.map(tile => ({ existingId: tile.id, label: tile.label, speech: tile.speech, language: tile.language, emoji: '🐄', color: tile.color })) } };
    const result = await prepareProposalPictures(board, envelope, settings);
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(result.proposal.pictures?.map(picture => picture.illustration)).toEqual(board.tiles.map(tile => tile.illustration));
  });
});
