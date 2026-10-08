/** @file Protects manual/legacy translations across edits, generation, source changes and AI proposals. */

import { describe, expect, it } from 'vitest';
import { starterLibrary } from '../../../tests/fixtures/library';
import { applyProposal, boardContext, migrateLibrary, tileSource, type BoardProposal } from './schema';
import { applyTranslations, editTileTranslation, missingTranslations, storedTileTranslation, tileInLanguage, validateTranslations } from './boardLanguages';
import { speechKey } from './speech';

function fixture() {
  const library = starterLibrary();
  const board = library.boards[0]; board.tiles = board.tiles.slice(0, 1);
  board.playLanguages = ['en-US', 'ru-RU', 'es-ES'];
  const tile = board.tiles[0]; tile.languageMode = 'board';
  tile.translations = [{ language: 'ru-RU', label: 'Корова', speech: 'корова', source: tileSource(tile) }];
  return { library, board, tile };
}
function proposal(board: ReturnType<typeof fixture>['board']): BoardProposal {
  return { boardId: board.id, baseRevision: board.revision, proposal: { title: 'Renamed', explanation: 'A change', needsClarification: false, tiles: board.tiles.map(tile => ({ existingId: tile.id, label: tile.label, speech: tile.speech, language: tile.language, emoji: '🐄', color: tile.color, translations: [{ language: 'ru-RU', label: 'Бурёнка', speech: 'бурёнка' }] })) } };
}
describe('translation corrections', () => {
  it('edits just the selected variant, retains incomplete drafts and round-trips manual provenance', () => {
    const { library, board, tile } = fixture();
    const corrected = editTileTranslation(tile, 'ru-ru', { label: 'Моя корова', speech: 'коровушка' });
    const partial = editTileTranslation(corrected, 'es-ES', { label: 'Vaca' });
    expect(partial).toMatchObject({ label: tile.label, speech: tile.speech, language: tile.language, id: tile.id, illustration: tile.illustration });
    expect(storedTileTranslation(partial, 'ru-RU')).toMatchObject({ speech: 'коровушка', origin: 'manual' });
    expect(storedTileTranslation(partial, 'es-ES')?.speech).toBe('');
    board.tiles[0] = editTileTranslation(partial, 'es-ES', { speech: 'vaca' });
    const loaded = migrateLibrary(JSON.parse(JSON.stringify(library))).boards[0];
    expect(loaded.tiles[0]).toEqual(board.tiles[0]);
    expect(boardContext(loaded).tiles[0].translations?.[0]).toMatchObject({ speech: 'коровушка' });
  });
  it('preserves inactive and stale corrections while filling only genuinely missing translations', () => {
    const { board, tile } = fixture();
    board.tiles[0] = { ...editTileTranslation(tile, 'fr-FR', { label: 'Vache', speech: 'vache' }), speech: 'Moo' };
    const request = missingTranslations(board)!;
    expect(request.tiles[0].targets).toEqual(['es-ES']);
    const saved = board.tiles[0].translations;
    board.tiles = applyTranslations(board, validateTranslations(request, { translations: [{ tileId: tile.id, language: 'es-ES', label: 'Vaca', speech: 'vaca' }] }));
    expect(board.tiles[0].translations).toEqual([...saved!, { language: 'es-ES', label: 'Vaca', speech: 'vaca', source: tileSource(board.tiles[0]), origin: 'generated' }]);
    expect(tileInLanguage(board.tiles[0], 'ru-RU').language).toBe('en-US');
    const reviewed = editTileTranslation(board.tiles[0], 'ru-RU', {});
    expect(tileInLanguage(reviewed, 'ru-RU').speech).toBe('корова');
  });
  it('keeps corrections through unrelated AI edits and requires explicit permission to replace them', () => {
    const { board, tile } = fixture();
    board.tiles[0] = editTileTranslation(tile, 'ru-RU', { speech: 'коровушка' });
    const draft = proposal(board);
    const kept = applyProposal(board, draft, () => 'unused');
    expect(kept.title).toBe('Renamed');
    expect(kept.tiles[0].translations).toEqual(board.tiles[0].translations);
    const replaced = applyProposal(board, draft, () => 'unused', undefined, true);
    expect(storedTileTranslation(replaced.tiles[0], 'ru-RU')).toMatchObject({ speech: 'бурёнка', origin: 'generated' });
    draft.proposal.tiles[0].speech = 'Moo';
    const changedSource = applyProposal(board, draft, () => 'unused');
    expect(storedTileTranslation(changedSource.tiles[0], 'ru-RU')?.speech).toBe('коровушка');
    expect(tileInLanguage(changedSource.tiles[0], 'ru-RU').language).toBe('en-US');
  });
  it('does not evict saved variants to fit extra AI output and still rejects stale board responses', () => {
    const { board, tile } = fixture();
    board.tiles[0].translations = ['ru-RU', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-PT'].map(language => ({ language, label: 'Saved', speech: 'saved', source: tileSource(tile) }));
    const draft = proposal(board); draft.proposal.tiles[0].translations = [{ language: 'ja-JP', label: '牛', speech: '牛' }];
    expect(() => applyProposal(board, draft, () => 'unused')).toThrow('limit');
    expect(() => applyProposal({ ...board, revision: board.revision + 1 }, draft, () => 'unused')).toThrow('changed');
    board.playLanguages = ['ja-JP'];
    const request = missingTranslations(board)!;
    expect(() => applyTranslations(board, validateTranslations(request, { translations: [{ tileId: tile.id, language: 'ja-JP', label: '牛', speech: '牛' }] }))).toThrow('six saved translations');
    expect(board.tiles[0].translations).toHaveLength(6);
  });
  it('changes audio identity for corrected speech, but keeps it for label-only corrections', () => {
    const { tile } = fixture();
    const key = (value: typeof tile) => { const resolved = tileInLanguage(value, 'ru-RU'); return speechKey({ text: resolved.speech, language: resolved.language }); };
    expect(key(editTileTranslation(tile, 'ru-RU', { label: 'Моя корова' }))).toBe(key(tile));
    expect(key(editTileTranslation(tile, 'ru-RU', { speech: 'коровушка' }))).not.toBe(key(tile));
  });
});
