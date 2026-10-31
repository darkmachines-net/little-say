/** @file Verifies shared user languages, board play subsets, profile changes, and preference validation. */

import { starterLibrary } from '../../../tests/fixtures/library';
import { describe, expect, it } from 'vitest';
import { initialLanguageProfile, getLanguageProfile, newTileLanguage, profileLanguages, boardPlayLanguages, boardWithProfileLanguages } from './languageProfile';
import { languageProfileSchema, migrateLibrary, proposalRequestSchema } from './schema';

const profile = { languages: ['es-ES', 'fr-FR'], defaultLanguage: 'fr-FR' };
describe('device language preferences', () => {
  it('starts with the device locale and accepts regional and custom languages', () => {
    expect(initialLanguageProfile('es-mx')).toEqual({ languages: ['es-MX'], defaultLanguage: 'es-MX' });
    expect(initialLanguageProfile('invalid_tag')).toEqual(initialLanguageProfile());
    expect(languageProfileSchema.parse({ languages: ['cy-GB', 'es-mx'], defaultLanguage: 'es-MX' })).toEqual({ languages: ['cy-GB', 'es-MX'], defaultLanguage: 'es-MX' });
  });
  it('rejects empty, duplicate, invalid, oversized, and inconsistent profiles', () => {
    for (const value of [
      { languages: [], defaultLanguage: 'en-US' },
      { languages: ['fr-FR', 'fr-fr'], defaultLanguage: 'fr-FR' },
      { languages: ['not_a_language'], defaultLanguage: 'not_a_language' },
      { languages: ['en', 'fr', 'es', 'de', 'nl', 'pl', 'ru'], defaultLanguage: 'en' },
      { languages: ['es-ES'], defaultLanguage: 'fr-FR' },
    ]) expect(languageProfileSchema.safeParse(value).success).toBe(false);
  });
  it('round trips preferences without rewriting boards or saved playback choices', () => {
    const library = starterLibrary();
    library.settings.languageProfile = profile;
    library.settings.boardLanguages = { 'starter-family': 'ru-RU' };
    const restored = migrateLibrary(JSON.parse(JSON.stringify(library)));
    expect(restored).toEqual(library);
    expect(restored.boards).toEqual(starterLibrary().boards.map((board, i) => ({ ...board, createdAt: library.boards[i].createdAt, updatedAt: library.boards[i].updatedAt })));
    delete library.settings.languageProfile;
    const legacy = migrateLibrary(library);
    expect(legacy.boards).toEqual(restored.boards);
    expect(getLanguageProfile(legacy.settings)).toEqual(initialLanguageProfile());
  });
  it('uses shared languages in default order, ignoring historical board generation languages', () => {
    const settings = { languageProfile: profile };
    expect(profileLanguages(settings)).toEqual(['fr-FR', 'es-ES']);
    expect(newTileLanguage({}, settings)).toBe('fr-FR');
    const board = { ...starterLibrary().boards[0], playLanguages: ['de-DE', 'it-IT'] };
    expect(boardPlayLanguages(board, settings)).toEqual(['fr-FR', 'es-ES']);
    expect(boardWithProfileLanguages(board, settings).playLanguages).toEqual(['fr-FR', 'es-ES']);
    expect(board.playLanguages).toEqual(['de-DE', 'it-IT']);
    expect(newTileLanguage({ playLanguageSubset: ['es-ES'] }, settings)).toBe('es-ES');
  });
  it('limits play without losing stored words, follows new preferences, and recovers an obsolete subset', () => {
    const board = { ...starterLibrary().boards[0], playLanguageSubset: ['es-es', 'de-DE'] };
    expect(boardPlayLanguages(board, { languageProfile: profile })).toEqual(['es-ES']);
    const changed = { languageProfile: { languages: ['fr-FR', 'uk-UA'], defaultLanguage: 'uk-UA' } };
    expect(boardPlayLanguages(board, changed)).toEqual(['uk-UA']);
    expect(boardPlayLanguages({ ...board, playLanguageSubset: undefined }, changed)).toEqual(['uk-UA', 'fr-FR']);
    expect(board.tiles).toEqual(starterLibrary().boards[0].tiles);
    expect(migrateLibrary({ ...starterLibrary(), boards: [board] }).boards[0].playLanguageSubset).toEqual(board.playLanguageSubset);
  });
  it('includes only validated language preferences in generation requests', () => {
    const request = { prompt: 'Animals', board: null, languageProfile: profile };
    expect(proposalRequestSchema.parse(request)).toEqual(request);
    expect(proposalRequestSchema.safeParse({ ...request, languageProfile: { languages: ['es-ES'], defaultLanguage: 'ru-RU' } }).success).toBe(false);
    expect(proposalRequestSchema.safeParse({ prompt: 'Animals', board: null }).success).toBe(true);
  });
});
