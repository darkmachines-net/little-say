/** @file Verifies sync preserves edits and saved language audio, propagates deletions, and requires complete assets. */

import { describe, expect, it } from 'vitest';
import { starterLibrary } from '../../../tests/fixtures/library';
import { mergeAssets, mergeBoards } from './account';
import { syncSnapshotSchema, tileSource, type SyncAsset } from './schema';

const board = starterLibrary().boards[0];
const edited = { ...board, revision: board.revision + 1, title: 'Changed here' };
const remote = { ...edited, title: 'Changed there' };
const id = () => 'conflict-id';
describe('board sync', () => {
  it('restores an account to an empty device and adds guest boards without removing remote boards', () => {
    expect(mergeBoards([], [], [board], id)).toEqual([board]);
    expect(mergeBoards([], [{ ...board, id: 'guest' }], [board], id)).toHaveLength(2);
  });
  it('pulls a remote change and pushes a local change relative to the acknowledgement', () => {
    expect(mergeBoards([board], [board], [remote], id)).toEqual([remote]);
    expect(mergeBoards([board], [edited], [board], id)).toEqual([edited]);
    expect(mergeBoards([board], [edited], [edited], id)).toEqual([edited]);
  });
  it('propagates deletions but rescues simultaneous edits on either side', () => {
    expect(mergeBoards([board], [], [board], id)).toEqual([]);
    expect(mergeBoards([board], [board], [], id)).toEqual([]);
    expect(mergeBoards([board], [], [remote], id)).toEqual([remote]);
    expect(mergeBoards([board], [edited], [], id)).toEqual([{ ...edited, id: 'conflict-id', title: 'Changed here (conflict copy)' }]);
  });
  it('preserves concurrent board changes and mid-flight foreground edits', () => {
    const result = mergeBoards([board], [edited], [remote], id);
    expect(result).toEqual([remote, { ...edited, id: 'conflict-id', title: 'Changed here (conflict copy)' }]);
    expect(mergeBoards([board], [edited], [board, { ...board, id: 'new-remote' }], id)).toEqual([edited, { ...board, id: 'new-remote' }]);
  });
  it('does not duplicate a conflict when a committed response was lost', () => {
    const committed = mergeBoards([board], [edited], [remote], id);
    expect(mergeBoards([board], [edited], committed, id)).toEqual(committed);
  });
  it('requires every photo, preserves speech selection changes, and drops unrelated assets', () => {
    const photoBoard = { ...board, tiles: [{ ...board.tiles[0], illustration: { kind: 'photo' as const, assetId: 'photo1', zoom: 1, x: 0, y: 0 } }] };
    const photo: SyncAsset = { kind: 'photo', id: 'photo1', hash: 'a'.repeat(64) };
    expect(() => mergeAssets([photoBoard], [], [], [])).toThrow('missing');
    expect(mergeAssets([photoBoard], [], [photo], [])).toEqual([photo]);
    expect(mergeAssets([], [], [photo], [])).toEqual([]);
    expect(() => mergeAssets([photoBoard], [], [photo], [{ ...photo, hash: 'b'.repeat(64) }])).toThrow('conflicting');
  });
  it('keeps saved translated audio when the user removes a language or limits board play', () => {
    const tile = { ...board.tiles[0], languageMode: 'board' as const, translations: [{ language: 'es-ES', label: 'Vaca', speech: 'vaca', source: tileSource(board.tiles[0]) }] };
    const limited = { ...board, playLanguages: ['en-US'], playLanguageSubset: ['en-US'], tiles: [tile] };
    const clip: SyncAsset = { kind: 'speech', id: 'a'.repeat(64), hash: 'b'.repeat(64), key: JSON.stringify(['vaca', 'es-ES']) };
    expect(mergeAssets([limited], [], [clip], [])).toEqual([clip]);
  });
  it('rejects duplicate board IDs, duplicate asset keys and unsafe local file IDs', () => {
    expect(syncSnapshotSchema.safeParse({ revision: 0, boards: [board, board], assets: [] }).success).toBe(false);
    expect(syncSnapshotSchema.safeParse({ revision: 0, boards: [], assets: [{ kind: 'photo', id: '../secret', hash: 'a'.repeat(64) }] }).success).toBe(false);
  });
});
