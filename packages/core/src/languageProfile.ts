/**
 * @file Derives new-board and new-card language defaults from the device profile while preserving board
 * choices.
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
 * Return saved device preferences or the fallback profile. Older libraries keep their boards
 * unchanged; preferences are opt-in.
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
 * Prefer the profile default when supported by the board, then the first board language, then the
 * profile default.
 */
export function newTileLanguage(board: Pick<Board, 'playLanguages'>, settings: Pick<Settings, 'languageProfile'>): string {
  const profile = getLanguageProfile(settings);
  return board.playLanguages?.find(tag => Intl.getCanonicalLocales(tag)[0] === profile.defaultLanguage) ?? board.playLanguages?.[0] ?? profile.defaultLanguage;
}

/**
 * Suggest play languages for setup, expanding to device preferences only when compatible with the
 * current selection. Explicit board choices take precedence over device defaults.
 */
export function suggestedPlayLanguages(board: Pick<Board, 'playLanguages'>, settings: Pick<Settings, 'languageProfile'>): string[] {
  const selected = board.playLanguages ?? [];
  const preferred = profileLanguages(settings);
  if (selected.length >= 2) return selected;
  if (selected.every(tag => preferred.includes(Intl.getCanonicalLocales(tag)[0]))) return preferred;
  return selected;
}

const greetings: Record<string, string> = { en: 'Hello', ru: 'Привет', es: 'Hola', fr: 'Bonjour', de: 'Hallo', it: 'Ciao', pt: 'Olá', zh: '你好', ja: 'こんにちは', ko: '안녕하세요', ar: 'مرحبًا', hi: 'नमस्ते', uk: 'Привіт', pl: 'Cześć', nl: 'Hallo', sv: 'Hej', tr: 'Merhaba', vi: 'Xin chào', id: 'Halo', he: 'שלום' };
/**
 * Provide a greeting and emoji for a new card, using the digit one when no greeting is bundled for that
 * language.
 */
export function firstWord(language: string): { label: string; speech: string; emoji: string } {
  const greeting = greetings[language.split('-')[0].toLowerCase()];
  // A digit remains pronounceable in languages without a bundled greeting.
  return { label: greeting ?? '1', speech: greeting ?? '1', emoji: greeting ? '👋' : '1️⃣' };
}
