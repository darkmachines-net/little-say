/** @file Resolves board language variants and validates revision-bound translation updates. */

import { z } from 'zod';
import { boardSchema, languageSchema, playLanguagesSchema, tileSource, translationSchema, type Board, type BoardChanges, type Tile, type Settings } from './schema';
import { speechKey } from './speech';

/** Canonicalize a BCP-47 language tag using Intl; invalid tags throw. */
export const canonicalLanguage = (tag: string) => Intl.getCanonicalLocales(tag)[0];
/** Use the saved language when it belongs to the board, otherwise the first play language or null. */
export function selectedBoardLanguage(board: Board, settings: Settings) {
  const preferred = settings.boardLanguages?.[board.id];
  return board.playLanguages?.find(tag => preferred && canonicalLanguage(tag) === canonicalLanguage(preferred)) ?? board.playLanguages?.[0] ?? null;
}
/**
 * Resolve each card for the selected board language, honoring fixed-language cards and
 * label-translation settings.
 */
export function boardPlayTiles(board: Board, settings: Settings) {
  return board.tiles.map(tile => tileInLanguage(tile, selectedBoardLanguage(board, settings), board.translateLabels !== false));
}
/** Extract validated language changes from a prepared board; reject a mismatched board ID or revision. */
export function applyLanguageSetup(current: Board, prepared: Board): BoardChanges {
  if (current.id !== prepared.id || current.revision !== prepared.revision) throw new Error('This board changed while translating. Prepare translations again to keep your latest edits.');
  const valid = boardSchema.parse(prepared);
  return { playLanguages: valid.playLanguages, tiles: valid.tiles, translateLabels: valid.translateLabels };
}
/** Find a translation for the requested language only when it still matches the card source text. */
export function tileTranslation(tile: Tile, language: string) {
  const translation = storedTileTranslation(tile, language);
  return translation?.source === tileSource(tile) ? translation : undefined;
}
/** Find saved words even when a source edit means they need explicit parent review. */
export function storedTileTranslation(tile: Tile, language: string) {
  return tile.translations?.find(t => canonicalLanguage(t.language) === canonicalLanguage(language));
}
/** Update one manual variant without filtering other languages; incomplete fields remain draft-only. */
export function editTileTranslation(tile: Tile, language: string, changes: Partial<Pick<Tile, 'label' | 'speech'>>): Tile {
  const old = storedTileTranslation(tile, language);
  const next = { language: canonicalLanguage(language), label: old?.label ?? '', speech: old?.speech ?? '', ...changes, source: tileSource(tile), origin: 'manual' as const };
  const translations = (tile.translations ?? []).filter(t => canonicalLanguage(t.language) !== next.language);
  if (old || next.label || next.speech) translations.push(next);
  return { ...tile, translations };
}
/** Check whether the card has either the requested base language or a current translation. */
export function hasTileLanguage(tile: Tile, language: string) {
  return canonicalLanguage(tile.language) === canonicalLanguage(language) || Boolean(tileTranslation(tile, language));
}
/**
 * Resolve a board-following card into a translated variant, optionally retaining its label; fixed cards
 * and untranslated languages keep the original pronunciation.
 */
export function tileInLanguage(tile: Tile, language: string | null, translateLabel = true): Tile {
  if (tile.languageMode !== 'board' || !language || canonicalLanguage(language) === canonicalLanguage(tile.language)) return tile;
  const translation = tileTranslation(tile, language);
  // Never pronounce untranslated text using the wrong language's voice.
  return translation ? { ...tile, label: translateLabel ? translation.label : tile.label, speech: translation.speech, language: translation.language } : tile;
}
/**
 * Collect distinct spoken text and language variants needed by the board, including each card base
 * pronunciation.
 */
export function boardAudioTiles(board: Board): Tile[] {
  const unique = new Map<string, Tile>();
  for (const tile of board.tiles) {
    for (const version of [tile, ...(tile.languageMode === 'board' ? (board.playLanguages ?? []).filter(tag => hasTileLanguage(tile, tag)).map(tag => tileInLanguage(tile, tag)) : [])]) {
      unique.set(speechKey({ text: version.speech, language: version.language }), version);
    }
  }
  return [...unique.values()];
}

export const translationRequestSchema = z.object({
  boardId: z.string().min(1).max(100), baseRevision: z.number().int().nonnegative(),
  tiles: z.array(z.object({ id: z.string().min(1).max(100), label: z.string().trim().min(1).max(80), speech: z.string().trim().min(1).max(200), language: languageSchema, targets: playLanguagesSchema.refine(tags => tags.length > 0) })).min(1).max(24),
}).refine(request => new Set(request.tiles.map(t => t.id)).size === request.tiles.length, 'Duplicate tile IDs.');
export const generatedTranslationsSchema = z.object({ translations: z.array(z.object({ tileId: z.string(), language: z.string(), label: z.string(), speech: z.string() })) });
export const translationEnvelopeSchema = z.object({ boardId: z.string(), baseRevision: z.number().int().nonnegative(), translations: z.array(translationSchema.extend({ tileId: z.string().min(1).max(100) })).max(144) });
export type TranslationRequest = z.infer<typeof translationRequestSchema>;
export type GeneratedTranslations = z.infer<typeof generatedTranslationsSchema>;
export type TranslationEnvelope = z.infer<typeof translationEnvelopeSchema>;
/**
 * Request missing or stale generated variants. Saved corrections are kept for explicit review;
 * null means no variants can be prepared automatically, not necessarily that all are current.
 */
export function missingTranslations(board: Board): TranslationRequest | null {
  const tiles = board.tiles.filter(tile => tile.languageMode === 'board').map(tile => ({
    id: tile.id, label: tile.label, speech: tile.speech, language: tile.language,
    targets: (board.playLanguages ?? []).filter(language => {
      const saved = storedTileTranslation(tile, language);
      return !hasTileLanguage(tile, language) && (!saved || saved.origin === 'generated');
    }),
  })).filter(tile => tile.targets.length > 0);
  return tiles.length ? { boardId: board.id, baseRevision: board.revision, tiles } : null;
}
/**
 * Validate that the response contains exactly the requested tile-language pairs; reject omissions,
 * duplicates, and unexpected translations.
 */
export function validateTranslations(request: TranslationRequest, result: GeneratedTranslations): TranslationEnvelope {
  const expected = new Set(request.tiles.flatMap(tile => tile.targets.map(tag => JSON.stringify([tile.id, canonicalLanguage(tag)]))));
  const envelope = translationEnvelopeSchema.parse({ ...request, translations: result.translations });
  for (const translation of envelope.translations) {
    const key = JSON.stringify([translation.tileId, canonicalLanguage(translation.language)]);
    if (!expected.delete(key)) throw new Error('Unexpected or duplicate translated tile.');
  }
  if (expected.size) throw new Error('Some translations were missing.');
  return envelope;
}
/**
 * Merge validated translations without changing board metadata, unrelated variants or saved corrections.
 * Reject stale revisions and storage overflow rather than silently evicting a language.
 */
export function applyTranslations(board: Board, envelope: TranslationEnvelope): Tile[] {
  if (board.id !== envelope.boardId || board.revision !== envelope.baseRevision) throw new Error('This board changed while translating. Prepare translations again to keep your latest edits.');
  const request = missingTranslations(board);
  if (!request) throw new Error('No translations are missing.');
  const validated = validateTranslations(request, envelope);
  return board.tiles.map(tile => {
    const translated = validated.translations.filter(t => t.tileId === tile.id);
    if (!translated.length) return tile;
    const translations = [
      ...(tile.translations ?? []).filter(t => !translated.some(next => canonicalLanguage(next.language) === canonicalLanguage(t.language))),
      ...translated.map(({ tileId, ...translation }) => ({ ...translation, source: tileSource(tile), origin: 'generated' as const })),
    ];
    if (translations.length > 6) throw new Error('This card already has six saved translations. Existing words have been kept; edit a saved language instead.');
    return { ...tile, translations };
  });
}
