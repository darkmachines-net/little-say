import { z } from 'zod';
import { boardSchema, languageSchema, playLanguagesSchema, tileSource, translationSchema, type Board, type BoardChanges, type Tile, type Settings } from './schema';
import { speechKey } from './speech';

export const canonicalLanguage = (tag: string) => Intl.getCanonicalLocales(tag)[0];
export function selectedBoardLanguage(board: Board, settings: Settings) {
  const preferred = settings.boardLanguages?.[board.id];
  return board.playLanguages?.find(tag => preferred && canonicalLanguage(tag) === canonicalLanguage(preferred)) ?? board.playLanguages?.[0] ?? null;
}
export function boardPlayTiles(board: Board, settings: Settings) {
  return board.tiles.map(tile => tileInLanguage(tile, selectedBoardLanguage(board, settings), board.translateLabels !== false));
}
export function applyLanguageSetup(current: Board, prepared: Board): BoardChanges {
  if (current.id !== prepared.id || current.revision !== prepared.revision) throw new Error('This board changed while translating. Prepare translations again to keep your latest edits.');
  const valid = boardSchema.parse(prepared);
  return { playLanguages: valid.playLanguages, tiles: valid.tiles, translateLabels: valid.translateLabels };
}
export function tileTranslation(tile: Tile, language: string) {
  return tile.translations?.find(t => canonicalLanguage(t.language) === canonicalLanguage(language) && t.source === tileSource(tile));
}
export function hasTileLanguage(tile: Tile, language: string) {
  return canonicalLanguage(tile.language) === canonicalLanguage(language) || Boolean(tileTranslation(tile, language));
}
export function tileInLanguage(tile: Tile, language: string | null, translateLabel = true): Tile {
  if (tile.languageMode !== 'board' || !language || canonicalLanguage(language) === canonicalLanguage(tile.language)) return tile;
  const translation = tileTranslation(tile, language);
  // Never pronounce untranslated text using the wrong language's voice.
  return translation ? { ...tile, label: translateLabel ? translation.label : tile.label, speech: translation.speech, language: translation.language } : tile;
}
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
export function missingTranslations(board: Board): TranslationRequest | null {
  const tiles = board.tiles.filter(tile => tile.languageMode === 'board').map(tile => ({
    id: tile.id, label: tile.label, speech: tile.speech, language: tile.language,
    targets: (board.playLanguages ?? []).filter(language => !hasTileLanguage(tile, language)),
  })).filter(tile => tile.targets.length > 0);
  return tiles.length ? { boardId: board.id, baseRevision: board.revision, tiles } : null;
}
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
export function applyTranslations(board: Board, envelope: TranslationEnvelope): Tile[] {
  if (board.id !== envelope.boardId || board.revision !== envelope.baseRevision) throw new Error('This board changed while translating. Prepare translations again to keep your latest edits.');
  const request = missingTranslations(board);
  if (!request) throw new Error('No translations are missing.');
  const validated = validateTranslations(request, envelope);
  return board.tiles.map(tile => {
    const translated = validated.translations.filter(t => t.tileId === tile.id);
    return translated.length ? { ...tile, translations: [
      ...(tile.translations ?? []).filter(t => t.source === tileSource(tile) && board.playLanguages?.some(tag => canonicalLanguage(tag) === canonicalLanguage(t.language)) && !translated.some(next => canonicalLanguage(next.language) === canonicalLanguage(t.language))),
      ...translated.map(({ tileId, ...translation }) => ({ ...translation, source: tileSource(tile) })),
    ] } : tile;
  });
}
