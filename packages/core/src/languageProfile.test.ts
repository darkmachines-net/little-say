/** @file Verifies device language defaults, board preference precedence, and profile validation. */

import { starterLibrary } from '../../../tests/fixtures/library';
import { describe, expect, it } from 'vitest';
import { initialLanguageProfile, getLanguageProfile, newTileLanguage, profileLanguages, suggestedPlayLanguages } from './languageProfile';
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
  it('uses the default first for new boards but honors explicit board choices', () => {
    const settings = { languageProfile: profile };
    expect(profileLanguages(settings)).toEqual(['fr-FR', 'es-ES']);
    expect(newTileLanguage({}, settings)).toBe('fr-FR');
    expect(newTileLanguage({ playLanguages: ['de-DE', 'it-IT'] }, settings)).toBe('de-DE');
    expect(suggestedPlayLanguages({}, settings)).toEqual(['fr-FR', 'es-ES']);
    expect(suggestedPlayLanguages({ playLanguages: ['de-DE', 'it-IT'] }, settings)).toEqual(['de-DE', 'it-IT']);
    expect(suggestedPlayLanguages({ playLanguages: ['ja-JP'] }, settings)).toEqual(['ja-JP']);
  });
  it('includes only validated language preferences in generation requests', () => {
    const request = { prompt: 'Animals', board: null, languageProfile: profile };
    expect(proposalRequestSchema.parse(request)).toEqual(request);
    expect(proposalRequestSchema.safeParse({ ...request, languageProfile: { languages: ['es-ES'], defaultLanguage: 'ru-RU' } }).success).toBe(false);
    expect(proposalRequestSchema.safeParse({ prompt: 'Animals', board: null }).success).toBe(true);
  });
});
