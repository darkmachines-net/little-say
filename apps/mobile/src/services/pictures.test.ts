/** @file Verifies default generation, source enforcement, emoji fallback, live verified previews, cancellation, and protected-picture retention. */

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
  for (const mode of ['library', 'emoji'] as const) it(`inherits ${mode} without generation unless the board explicitly overrides it`, async () => {
    delete board.picturePolicy;
    settings.pictureDefaults = { ...defaultPicturePolicy, mode };
    const inherited = await prepareBoardPictures(board, settings, { restyle: true, regenerate: true });
    const jobs = mocks.fetch.mock.calls.filter(call => call[1].endsWith('/jobs'));
    if (mode === 'emoji') expect(jobs).toHaveLength(0);
    else { expect(jobs).toHaveLength(2); expect(jobs.every(call => !JSON.parse(call[2].body).allowGeneration)).toBe(true); }
    expect(inherited.board.tiles.every(tile => tile.illustration.kind === 'emoji')).toBe(true);
    mocks.fetch.mockClear();
    board.picturePolicy = { ...defaultPicturePolicy, mode: 'generated' };
    const explicit = await prepareBoardPictures(board, settings, { restyle: true, regenerate: true });
    expect(explicit.board.tiles.every(tile => tile.illustration.kind === 'generated')).toBe(true);
    expect(mocks.fetch.mock.calls.filter(call => call[1].endsWith('/jobs')).every(call => JSON.parse(call[2].body).allowGeneration)).toBe(true);
  });

  it('keeps accurate emoji without creating picture jobs, even with legacy consistency enabled', async () => {
    board.picturePolicy = { ...defaultPicturePolicy, consistent: true };
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (...args: any[]) => {
      const result = await original(...args);
      if (args[1].endsWith('/analyze')) result.tiles.forEach((tile: any) => { tile.concept.emojiAccurate = true; });
      return result;
    });
    const result = await prepareBoardPictures(board, settings);
    expect(result.board.tiles.map(tile => tile.illustration)).toEqual(board.tiles.map(tile => tile.illustration));
    expect(mocks.fetch.mock.calls.map(call => call[1])).toEqual(['/api/pictures/analyze']);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('fills only the emoji gap and keeps good emoji and saved library artwork intact', async () => {
    board = { ...starterLibrary().boards[0], picturePolicy: { ...defaultPicturePolicy, consistent: true }, tiles: starterLibrary().boards[0].tiles.slice(0, 3) };
    board.tiles[1].illustration = { kind: 'library', assetId: 'c'.repeat(64), style: 'color', provenance: { library: 'mulberry', sourceId: 'sheep', sourceUrl: 'https://mulberrysymbols.org/', author: 'Steve Lee', license: 'CC-BY-SA-4.0', modified: '' } };
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (...args: any[]) => {
      const result = await original(...args);
      if (args[1].endsWith('/analyze')) result.tiles[0].concept.emojiAccurate = true;
      return result;
    });
    const result = await prepareBoardPictures(board, settings);
    expect(result.board.tiles.map(tile => tile.illustration.kind)).toEqual(['emoji', 'library', 'generated']);
    expect(result.board.tiles.slice(0, 2).map(tile => tile.illustration)).toEqual(board.tiles.slice(0, 2).map(tile => tile.illustration));
    expect(mocks.fetch.mock.calls.filter(call => call[1].endsWith('/jobs')).map(call => JSON.parse(call[2].body).tileId)).toEqual([board.tiles[2].id]);
  });
  it('does not accept a generated result when image generation was not permitted', async () => {
    const result = await prepareBoardPictures(board, settings, { allowGeneration: false });
    expect(result.board.tiles.every(tile => tile.illustration.kind === 'emoji')).toBe(true);
    expect(result.issues).toHaveLength(1); expect(result.issues[0]).toContain('closest emoji for 2 cards'); expect(mocks.save).not.toHaveBeenCalled();
    expect(board.tiles.every(tile => tile.illustration.kind === 'emoji')).toBe(true);
  });
  it('preserves a saved picture after a failed replacement download', async () => {
    board.tiles[0].illustration = { kind: 'generated', assetId: 'b'.repeat(64), style: 'color', description: 'cow', model: 'test' };
    mocks.save.mockRejectedValue(new Error('Storage full'));
    const result = await prepareBoardPictures(board, settings, { restyle: true, allowGeneration: true });
    expect(result.board.tiles[0].illustration).toEqual(board.tiles[0].illustration);
    expect(result.issues.join(' ')).toContain('Existing pictures were kept');
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
    expect(result.issues.join(' ')).toContain('closest emoji'); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('restores a photo when its explicitly requested replacement fails the final visual review', async () => {
    const photo = { kind: 'photo' as const, assetId: 'private-photo', zoom: 1, x: 0, y: 0 };
    board.tiles[0].illustration = photo;
    board.tiles[0].pictureOptions = { locked: true, instruction: '' };
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (...args: any[]) => args[1].endsWith('/review') ? { rejected: [board.tiles[0].id] } : original(...args));
    const result = await prepareBoardPictures(board, settings, { targetIds: new Set([board.tiles[0].id]), replaceProtected: true, restyle: true, allowGeneration: true });
    expect(result.board.tiles[0].illustration).toEqual(photo);
    expect(result.issues.join(' ')).toContain('Existing pictures were kept');
    expect(JSON.stringify(mocks.fetch.mock.calls)).not.toContain('private-photo');
  });
  it('changes only explicitly requested pictures in a saved AI board', async () => {
    const envelope = { boardId: board.id, baseRevision: board.revision, proposal: { title: 'Renamed', explanation: 'Renamed.', needsClarification: false, picturePolicy: defaultPicturePolicy, tiles: board.tiles.map(tile => ({ existingId: tile.id, label: tile.label, speech: tile.speech, language: tile.language, emoji: '🐄', color: tile.color })) } };
    const result = await prepareProposalPictures(board, envelope, settings);
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(result.proposal.pictures?.map(picture => picture.illustration)).toEqual(board.tiles.map(tile => tile.illustration));
  });
  it('uses color for new pictures even when a saved board has legacy outline preferences', async () => {
    board.picturePolicy = { ...defaultPicturePolicy, style: 'line' };
    board.tiles[0].pictureOptions = { locked: false, instruction: '', style: 'line' };
    const result = await prepareBoardPictures(board, settings, { restyle: true, allowGeneration: true });
    expect(result.board.picturePolicy?.style).toBe('color');
    const requests = mocks.fetch.mock.calls.filter(call => call[1].endsWith('/jobs')).map(call => JSON.parse(call[2].body));
    expect(requests).toHaveLength(2); expect(requests.every(request => request.style === 'color')).toBe(true);
  });
  it('generates by default even when the earlier default-off setting is present', async () => {
    const result = await prepareBoardPictures(board, settings);
    expect(result.board.tiles.every(tile => tile.illustration.kind === 'generated')).toBe(true);
    expect(mocks.fetch.mock.calls.filter(call => call[1].endsWith('/jobs')).every(call => JSON.parse(call[2].body).allowGeneration)).toBe(true);
  });
  it('keeps library-only requests generation-free and uses analyzed emoji for missing matches', async () => {
    board.picturePolicy = { ...defaultPicturePolicy, mode: 'library' };
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (...args: any[]) => {
      const result = await original(...args);
      if (args[1].endsWith('/analyze')) result.tiles.forEach((tile: any) => { tile.emoji = '🐑'; });
      return args[1].endsWith('/jobs') ? { ...result, result: { kind: 'unresolved', reason: 'No match. Enable AI pictures.' } } : result;
    });
    const result = await prepareBoardPictures(board, settings);
    expect(result.board.tiles.map(tile => tile.illustration)).toEqual([{ kind: 'emoji', emoji: '🐑' }, { kind: 'emoji', emoji: '🐑' }]);
    expect(result.issues).toHaveLength(1); expect(result.issues[0]).not.toContain('Enable');
    expect(mocks.fetch.mock.calls.filter(call => call[1].endsWith('/jobs')).every(call => !JSON.parse(call[2].body).allowGeneration)).toBe(true);
  });
  it('publishes each durable image as it arrives without mutating an earlier preview', async () => {
    let release!: () => void;
    mocks.save.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const previews: Board[] = []; const states: string[] = [];
    const work = prepareBoardPictures(board, settings, { preview: preview => previews.push(preview), tileProgress: (id, state) => states.push(`${id}:${state}`) });
    await vi.waitFor(() => expect(previews).toHaveLength(1));
    expect(previews[0].tiles.map(tile => tile.illustration.kind)).toEqual(['emoji', 'generated']);
    expect(states).toContain(`${board.tiles[0].id}:working`); expect(states).toContain(`${board.tiles[1].id}:ready`);
    release(); const result = await work;
    expect(result.board.tiles.map(tile => tile.illustration.kind)).toEqual(['generated', 'generated']);
    expect(previews[0].tiles[0].illustration.kind).toBe('emoji');
    expect(board.tiles.every(tile => tile.illustration.kind === 'emoji')).toBe(true);
  });
  it('keeps a usable board when analysis or the final image review fails', async () => {
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockRejectedValueOnce(new Error('Offline'));
    const offline = await prepareBoardPictures(board, settings);
    expect(offline.board.tiles.map(tile => tile.illustration)).toEqual(board.tiles.map(tile => tile.illustration));
    mocks.fetch.mockImplementation(async (...args: any[]) => args[1].endsWith('/review') ? { rejected: board.tiles.map(tile => tile.id) } : original(...args));
    const rejected = await prepareBoardPictures(board, settings);
    expect(rejected.board.tiles.every(tile => tile.illustration.kind === 'emoji')).toBe(true); expect(rejected.issues).toHaveLength(1);
  });
});
