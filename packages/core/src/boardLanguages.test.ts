/**
 * @file Verifies fixed and board-following language resolution, translation freshness, and
 * revision-safe translation application with shared user languages and optional board subsets.
 */

import { starterLibrary } from '../../../tests/fixtures/library';
import { describe, expect, it } from 'vitest';
import { applyProposal, boardContext, migrateLibrary, playLanguagesSchema, reviseBoard, tileSource } from './schema';
import { applyTranslations, boardAudioTiles, boardPlayTiles, missingTranslations, selectedBoardLanguage, tileInLanguage, translationRequestSchema, validateTranslations } from './boardLanguages';

function bilingual() {
  const board = starterLibrary().boards[0];
  board.playLanguages = ['en-US', 'ru-RU'];
  board.tiles = board.tiles.slice(0, 2);
  board.tiles[0].languageMode = 'board';
  board.tiles[0].translations = [{ language: 'ru-RU', label: 'Корова', speech: 'корова', source: tileSource(board.tiles[0]) }];
  return board;
}
describe('board languages', () => {
  it('keeps existing and explicitly fixed cards unchanged while switching both label and speech', () => {
    const board = bilingual();
    expect(tileInLanguage(board.tiles[0], 'ru-RU')).toMatchObject({ id: board.tiles[0].id, label: 'Корова', speech: 'корова', language: 'ru-RU' });
    expect(tileInLanguage(board.tiles[1], 'ru-RU')).toEqual(board.tiles[1]);
    expect(tileInLanguage({ ...board.tiles[0], languageMode: 'fixed' }, 'ru-RU').language).toBe('en-US');
    expect(migrateLibrary(starterLibrary())).toMatchObject({ version: 2 });
  });
  it('can switch speech only, persists the chosen language, and ignores a removed choice', () => {
    const board = bilingual(); board.translateLabels = false;
    const settings = { ...starterLibrary().settings, languageProfile: { languages: ['en-US', 'ru-RU'], defaultLanguage: 'en-US' }, boardLanguages: { [board.id]: 'ru-RU' } };
    expect(boardPlayTiles(board, settings)[0]).toMatchObject({ label: 'Cow', speech: 'корова', language: 'ru-RU' });
    expect(selectedBoardLanguage({ ...board, playLanguageSubset: ['en-US'] }, settings)).toBe('en-US');
    expect(selectedBoardLanguage({ ...board, playLanguages: [] }, settings)).toBe('ru-RU');
    expect(selectedBoardLanguage(board, { ...settings, languageProfile: { languages: ['en-US'], defaultLanguage: 'en-US' } })).toBe('en-US');
  });
  it('never speaks original words with the wrong language when a translation is missing or stale', () => {
    const board = bilingual(); board.tiles[0].speech = 'Moo';
    expect(tileInLanguage(board.tiles[0], 'ru-RU')).toEqual(board.tiles[0]);
    expect(missingTranslations(board)).toBeNull(); // Unknown-origin saved words require review, not overwrite.
    expect(boardAudioTiles(board).map(t => t.speech)).toEqual(['Moo', 'Sheep']);
  });
  it('prepares each distinct base and selected translated sound once, skipping fixed variants', () => {
    const board = bilingual(); board.tiles.push({ ...board.tiles[0], id: 'duplicate' });
    expect(boardAudioTiles(board).map(t => [t.speech, t.language])).toEqual([['Cow', 'en-US'], ['корова', 'ru-RU'], ['Sheep', 'en-US']]);
    board.tiles[0].languageMode = 'fixed'; board.tiles.pop();
    expect(boardAudioTiles(board)).toHaveLength(2);
  });
  it('validates exact translation pairs and rejects missing, duplicate, or invented results', () => {
    const board = bilingual(); board.tiles[0].translations = [];
    const request = missingTranslations(board)!;
    const result = { translations: [{ tileId: board.tiles[0].id, language: 'ru-RU', label: 'Корова', speech: 'корова' }] };
    const envelope = validateTranslations(request, result);
    expect(applyTranslations(board, envelope)[0].translations?.[0].source).toBe(tileSource(board.tiles[0]));
    expect(() => validateTranslations(request, { translations: [] })).toThrow('missing');
    expect(() => validateTranslations(request, { translations: [...result.translations, ...result.translations] })).toThrow('duplicate');
    expect(() => validateTranslations(request, { translations: [{ ...result.translations[0], language: 'fr-FR' }] })).toThrow('Unexpected');
    expect(() => applyTranslations(reviseBoard(board, { title: 'Edited' }), envelope)).toThrow('changed');
  });
  it('rejects invalid language input without crashing safeParse, duplicate targets, and duplicate IDs', () => {
    expect(playLanguagesSchema.safeParse(['not_a_locale']).success).toBe(false);
    expect(playLanguagesSchema.safeParse(['en-US', 'en-us']).success).toBe(false);
    const board = bilingual(); board.tiles[0].translations = [];
    const request = missingTranslations(board)!;
    expect(translationRequestSchema.safeParse({ ...request, tiles: [...request.tiles, ...request.tiles] }).success).toBe(false);
    expect(translationRequestSchema.safeParse({ ...request, tiles: [{ ...request.tiles[0], targets: ['ru-RU', 'ru-ru'] }] }).success).toBe(false);
  });
  it('retains fresh translations and modes across unrelated legacy AI edits', () => {
    const board = bilingual();
    board.playLanguageSubset = ['en-US'];
    const proposal = { title: 'Our animals', explanation: 'Renamed.', needsClarification: false, tiles: board.tiles.map(t => ({ existingId: t.id, label: t.label, speech: t.speech, language: t.language, emoji: '🐄', color: t.color })) };
    const next = applyProposal(board, { boardId: board.id, baseRevision: board.revision, proposal }, () => 'unused');
    expect(next.playLanguages).toEqual(board.playLanguages);
    expect(next.playLanguageSubset).toEqual(['en-US']);
    expect(next.tiles[0].translations).toEqual(board.tiles[0].translations);
    expect(next.tiles[0].languageMode).toBe('board');
    expect(JSON.stringify(boardContext(board))).not.toContain('source');
  });
});
