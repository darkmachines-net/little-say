import { starterLibrary } from '../../../tests/fixtures/library';
import { describe, expect, it } from 'vitest';
import { applyProposal, boardContext, migrateLibrary, validateGeneratedBoard, type GeneratedBoard } from './schema';
const draft: GeneratedBoard = { title: 'Farm', explanation: 'A farm board.', needsClarification: false, tiles: [{ existingId: null, label: 'Cow', speech: 'Cow', language: 'en-US', emoji: '🐄', color: 'sage' }] };
describe('safe local board proposals', () => {
  it('keeps a retained photo and mixed-language pronunciation, using new IDs only for replacements', () => {
    const current = starterLibrary().boards[2]; current.tiles[4].illustration = { kind: 'photo', assetId: 'private-photo', zoom: 1.5, x: 0.2, y: 0 };
    const proposal: GeneratedBoard = { ...draft, tiles: current.tiles.map(t => ({ existingId: t.id, label: t.label, speech: t.speech, language: t.language, color: t.color, emoji: '👵' })) };
    const updated = applyProposal(current, { boardId: current.id, baseRevision: current.revision, proposal }, () => 'new-id');
    expect(updated.tiles[4]).toEqual(current.tiles[4]); expect(updated.revision).toBe(1);
    expect(JSON.stringify(boardContext(current))).not.toContain('private-photo');
  });
  it('does not reuse a photo when replacing a tile with a new concept', () => {
    const current = starterLibrary().boards[0]; current.tiles[0].illustration = { kind: 'photo', assetId: 'cow-photo', zoom: 1, x: 0, y: 0 };
    const updated = applyProposal(current, { boardId: current.id, baseRevision: 0, proposal: draft }, () => 'new-cow');
    expect(updated.tiles[0].illustration.kind).toBe('emoji'); expect(updated.tiles[0].id).toBe('new-cow');
  });
  it('accepts the unused empty emoji on a retained photo but requires one for a replacement', () => {
    const current = starterLibrary().boards[0];
    current.tiles[0].illustration = { kind: 'photo', assetId: 'cow-photo', zoom: 1.5, x: 0.2, y: 0 };
    const value = { ...draft, tiles: [{ ...draft.tiles[0], existingId: current.tiles[0].id, emoji: '' }] };
    const board = applyProposal(current, { boardId: current.id, baseRevision: current.revision, proposal: value }, () => 'new');
    expect(board.tiles[0].illustration).toEqual(current.tiles[0].illustration);
    expect(() => validateGeneratedBoard({ ...value, tiles: [{ ...value.tiles[0], existingId: null }] }, boardContext(current))).toThrow();
  });
  it('rejects stale revisions, unknown/duplicate references, invalid languages and oversized boards', () => {
    const current = starterLibrary().boards[0];
    expect(() => applyProposal(current, { boardId: current.id, baseRevision: 99, proposal: draft }, () => 'new')).toThrow('changed');
    expect(() => validateGeneratedBoard({ ...draft, tiles: [{ ...draft.tiles[0], existingId: 'unrelated' }] }, boardContext(current))).toThrow('reference');
    const existing = { ...draft.tiles[0], existingId: current.tiles[0].id };
    expect(() => validateGeneratedBoard({ ...draft, tiles: [existing, existing] }, boardContext(current))).toThrow('reference');
    expect(() => validateGeneratedBoard({ ...draft, tiles: [{ ...draft.tiles[0], language: 'not_a_locale' }] }, null)).toThrow();
    expect(() => validateGeneratedBoard({ ...draft, tiles: Array(25).fill(draft.tiles[0]) }, null)).toThrow('1–24');
  });
  it('does not turn clarification into a saved board', () => {
    expect(() => applyProposal(null, { boardId: null, baseRevision: null, proposal: { ...draft, needsClarification: true, explanation: 'Please choose up to 24 tiles.' } }, () => 'new')).toThrow('24');
  });
  it('preserves valid data and refuses unknown/corrupt storage without resetting it', () => {
    const library = starterLibrary(); expect(migrateLibrary(library)).toEqual(library);
    expect(() => migrateLibrary({ ...library, version: 2 })).toThrow();
    expect(() => migrateLibrary({ ...library, boards: [{ ...library.boards[0], tiles: [] }] })).toThrow();
  });
});
