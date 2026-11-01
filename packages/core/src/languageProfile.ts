/**
 * @file Resolves shared user languages, optional board play subsets, and new-card language defaults.
 */

import { languageProfileSchema, type Board, type LanguageProfile, type Settings } from './schema';

/**
 * Create a canonical single-language profile from the locale, falling back to English when it is
 * invalid.
 */
export function initialLanguageProfile(locale = 'en-US'): LanguageProfile {
  const parsed = languageProfileSchema.safeParse({ languages: [locale], defaultLanguage: locale });
  return parsed.success ? parsed.data : { languages: ['en-US'], defaultLanguage: 'en-US' };
}

/**
 * Return saved user preferences or the fallback profile without rewriting board content.
 */
export function getLanguageProfile(settings: Pick<Settings, 'languageProfile'>): LanguageProfile {
  return settings.languageProfile ?? initialLanguageProfile();
}

/** List the profile languages with the default language first. */
export function profileLanguages(settings: Pick<Settings, 'languageProfile'>): string[] {
  const profile = getLanguageProfile(settings);
  return [profile.defaultLanguage, ...profile.languages.filter(tag => tag !== profile.defaultLanguage)];
}

/**
 * Resolve play languages in profile order. Ignore removed subset entries; if none remain, use the
 * profile default so a board never becomes unplayable. Historical generated languages are retained
 * on the board but do not restrict the user's selection.
 */
export function boardPlayLanguages(board: Pick<Board, 'playLanguageSubset'>, settings: Pick<Settings, 'languageProfile'>): string[] {
  const preferred = profileLanguages(settings);
  if (!board.playLanguageSubset) return preferred;
  const subset = board.playLanguageSubset.map(tag => Intl.getCanonicalLocales(tag)[0]);
  const selected = preferred.filter(tag => subset.includes(tag));
  return selected.length ? selected : [preferred[0]];
}

/**
 * Return a view of a board with effective play languages for editing, generation, and audio planning.
 * The saved board and its translations remain untouched; persist explicit changes via reviseBoard.
 */
export function boardWithProfileLanguages(board: Board, settings: Pick<Settings, 'languageProfile'>): Board {
  return { ...board, playLanguages: boardPlayLanguages(board, settings) };
}

/** Prefer the user default within the board's play subset, falling back to its first play language. */
export function newTileLanguage(board: Pick<Board, 'playLanguageSubset'>, settings: Pick<Settings, 'languageProfile'>): string {
  return boardPlayLanguages(board, settings)[0];
}
