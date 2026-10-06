/** @file Verifies semantic collision fallback, explicit picture policies, protected assets, and lossless library migration. */

import { describe, expect, it } from 'vitest';
import { applyProposal, boardContext, migrateLibrary } from './schema';
import { pictureTargets, defaultPicturePolicy, type PictureConcept } from './pictures';
import { starterLibrary } from '../../../tests/fixtures/library';

const concept = (description: string, emojiAccurate = true): PictureConcept => ({ description, emojiAccurate, features: [], searchTerms: [description] });
const tile = (id: string, emoji: string, description: string, emojiAccurate = true) => ({ id, emoji, concept: concept(description, emojiAccurate), locked: false });
describe('picture selection policy', () => {
  it('targets each construction gap when concepts share inaccurate generic emoji', () => {
    const cards = [tile('dump', '🚚', 'dump truck', false), tile('mixer', '🚚', 'concrete mixer truck', false), tile('excavator', '🚜', 'excavator', false), tile('dozer', '🚜', 'bulldozer', false), tile('crane', '🏗️', 'crane truck', false), tile('roller', '🚜', 'road roller', false)];
    expect([...pictureTargets(cards, defaultPicturePolicy)]).toEqual(cards.map(card => card.id));
  });
  it('catches inaccurate unique emoji and ignores duplicate labels for the same meaning', () => {
    expect(pictureTargets([tile('a', '🚜', 'road roller', false)], defaultPicturePolicy).has('a')).toBe(true);
    expect(pictureTargets([tile('a', '🐄', 'cow'), tile('b', '🐄', 'cow')], defaultPicturePolicy).size).toBe(0);
    expect(pictureTargets([tile('a', '✈️', 'jet'), tile('b', '✈', 'glider')], defaultPicturePolicy).size).toBe(2);
  });
  it('keeps protected and emoji-only cards and supports mixed pictures', () => {
    const cards = [tile('a', '🐄', 'cow'), tile('b', '🚜', 'excavator', false), { ...tile('c', '🚜', 'bulldozer', false), locked: true }];
    expect([...pictureTargets(cards, { ...defaultPicturePolicy, consistent: false })]).toEqual(['b']);
    expect([...pictureTargets(cards, { ...defaultPicturePolicy, consistent: true })]).toEqual(['b']);
    expect(pictureTargets(cards, { ...defaultPicturePolicy, mode: 'emoji' }).size).toBe(0);
    expect([...pictureTargets(cards, { ...defaultPicturePolicy, mode: 'library' })]).toEqual(['a', 'b']);
  });
});
describe('picture persistence and AI edits', () => {
  it('migrates v1 without changing pictures, language settings or crop framing', () => {
    const library = starterLibrary(); library.boards[0].tiles[0].illustration = { kind: 'photo', assetId: 'local-only', zoom: 1.8, x: 0.4, y: -0.1 };
    const migrated = migrateLibrary({ ...library, version: 1 });
    expect(migrated).toEqual(library); expect(migrated.version).toBe(2); expect(migrated.settings.autoImages).toBeUndefined();
  });
  it('preserves generated assets in text-only edits and omits asset IDs from network context', () => {
    const board = starterLibrary().boards[0];
    board.tiles[0].illustration = { kind: 'generated', assetId: 'a'.repeat(64), style: 'color', description: 'cow', model: 'test' };
    board.tiles[0].pictureOptions = { locked: true, instruction: '' };
    const proposal = { title: 'New title', explanation: 'Renamed.', needsClarification: false, tiles: board.tiles.map(t => ({ existingId: t.id, label: t.label, speech: t.speech, language: t.language, emoji: '🐄', color: t.color })) };
    const applied = applyProposal(board, { boardId: board.id, baseRevision: board.revision, proposal }, () => 'new');
    expect(applied.tiles[0].illustration).toEqual(board.tiles[0].illustration);
    expect(JSON.stringify(boardContext(board))).not.toContain('a'.repeat(64));
    expect(() => applyProposal(board, { boardId: board.id, baseRevision: board.revision, proposal, pictures: [{ index: 23, illustration: { kind: 'emoji', emoji: '🐄' } }] }, () => 'new')).toThrow('picture draft');
  });
});
