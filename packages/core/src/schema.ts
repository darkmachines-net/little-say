/** @file Defines durable library and AI payload schemas and guards revision-safe board edits. */

import { z } from 'zod';
import { MAX_PHOTO_ZOOM } from './photo';
import { picturePolicySchema, pictureOptionsSchema, pictureConceptSchema, pictureModeSchema, pictureStyleSchema, libraryPictureSchema, generatedPictureSchema, unresolvedPictureSchema } from './pictures';

export const MAX_TILES = 24;
export const colors = ['sage', 'peach', 'butter', 'sky', 'lilac', 'rose'] as const;
export const languageSchema = z.string().min(2).max(35).refine(value => {
  try { return Intl.getCanonicalLocales(value).length === 1; } catch { return false; }
}, 'Choose a valid language tag, such as en-US or ru-RU.');
export const illustrationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('emoji'), emoji: z.string().min(1).max(32) }),
  z.object({ kind: z.literal('photo'), assetId: z.string().min(1).max(100), zoom: z.number().min(1).max(MAX_PHOTO_ZOOM), x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }),
  libraryPictureSchema, generatedPictureSchema, unresolvedPictureSchema,
]);
export const translationSchema = z.object({ language: languageSchema, label: z.string().trim().min(1).max(80), speech: z.string().trim().min(1).max(200) });
// Older entries have unknown provenance and are protected like manual corrections.
export const storedTranslationSchema = translationSchema.extend({ source: z.string().max(700), origin: z.enum(['generated', 'manual']).optional() });
export const playLanguagesSchema = z.array(languageSchema).max(6).refine(tags => {
  try { return new Set(tags.map(tag => Intl.getCanonicalLocales(tag)[0])).size === tags.length; } catch { return false; }
}, 'Choose each play language once.');
export const languageProfileSchema = z.object({
  languages: playLanguagesSchema.refine(tags => tags.length > 0, 'Choose at least one language.'),
  defaultLanguage: languageSchema,
}).refine(profile => {
  try { return profile.languages.some(tag => Intl.getCanonicalLocales(tag)[0] === Intl.getCanonicalLocales(profile.defaultLanguage)[0]); } catch { return false; }
}, 'The default language must be in your language list.')
  .transform(profile => ({ languages: profile.languages.map(tag => Intl.getCanonicalLocales(tag)[0]), defaultLanguage: Intl.getCanonicalLocales(profile.defaultLanguage)[0] }));
export type LanguageProfile = z.infer<typeof languageProfileSchema>;
export const tileSchema = z.object({
  id: z.string().min(1).max(100), label: z.string().trim().min(1).max(80),
  speech: z.string().trim().min(1).max(200), language: languageSchema,
  color: z.enum(colors), illustration: illustrationSchema,
  pictureOptions: pictureOptionsSchema.optional(), pictureConcept: pictureConceptSchema.optional(),
  languageMode: z.enum(['fixed', 'board']).optional(),
  translations: z.array(storedTranslationSchema).max(6).optional(),
});
export const boardSchema = z.object({
  id: z.string().min(1).max(100), title: z.string().trim().min(1).max(100),
  revision: z.number().int().nonnegative(), tiles: z.array(tileSchema).min(1).max(MAX_TILES),
  createdAt: z.string(), updatedAt: z.string(),
  playLanguages: playLanguagesSchema.optional(), translateLabels: z.boolean().optional(),
  picturePolicy: picturePolicySchema.optional(),
}).refine(board => new Set(board.tiles.map(t => t.id)).size === board.tiles.length, 'Tiles must have unique IDs.');
export const settingsSchema = z.object({
  backendUrl: z.string().max(500), voices: z.record(z.string(), z.string()),
  activeBoardId: z.string().nullable(), aiConsent: z.boolean(),
  // Local launch preference only; choosing guest never enables backup or AI consent.
  accountChoiceMade: z.boolean().optional(),
  autoSpeech: z.boolean().default(true),
  // Per-language source replaces the legacy global automatic-audio switch; device IDs remain in voices.
  voiceSources: z.record(z.string(), z.enum(['ai', 'device'])).optional(),
  pictureDefaults: picturePolicySchema.optional(),
  // Read older libraries losslessly; picture source now governs generation instead of this legacy flag.
  autoImages: z.boolean().optional(),
  boardLanguages: z.record(z.string(), languageSchema).optional(),
  languageProfile: languageProfileSchema.optional(),
});
export const starterTopicSchema = z.enum(['farm', 'everyday', 'family']);
export type StarterTopic = z.infer<typeof starterTopicSchema>;
export const starterTopicsSchema = z.array(starterTopicSchema).min(1).max(3).refine(topics => new Set(topics).size === topics.length);
export const setupSchema = z.object({
  stage: z.enum(['languages', 'boards']), topics: starterTopicsSchema,
  drafts: z.array(z.object({ topic: starterTopicSchema, board: boardSchema })).max(3).refine(drafts => new Set(drafts.map(draft => draft.topic)).size === drafts.length),
});
export const syncAssetSchema = z.object({
  kind: z.enum(['photo', 'picture', 'speech']),
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  key: z.string().max(500).optional(),
}).refine(asset => asset.kind === 'speech' ? Boolean(asset.key) && /^[a-f0-9]{64}$/.test(asset.id) : !asset.key);
export const syncSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  boards: z.array(boardSchema).max(500), assets: z.array(syncAssetSchema).max(15000),
}).refine(snapshot => new Set(snapshot.boards.map(board => board.id)).size === snapshot.boards.length, 'Board IDs must be unique.')
  .refine(snapshot => new Set(snapshot.assets.map(asset => `${asset.kind}:${asset.key ?? asset.id}`)).size === snapshot.assets.length, 'Asset references must be unique.');
export type SyncAsset = z.infer<typeof syncAssetSchema>;
export type SyncSnapshot = z.infer<typeof syncSnapshotSchema>;
export const librarySchema = z.object({
  version: z.literal(2), boards: z.array(boardSchema), settings: settingsSchema, setup: setupSchema.optional(),
  // Device usage belongs outside board content, revisions, AI requests, and undo.
  boardLastPlayedAt: z.record(z.string(), z.number().int().nonnegative()).optional(),
  favoriteBoardIds: z.array(z.string().min(1).max(100)).optional(),
  // The acknowledged server snapshot travels atomically with local boards; credentials never do.
  sync: z.object({ accountId: z.string(), server: z.string(), snapshot: syncSnapshotSchema, savedAt: z.string() }).optional(),
});
export type Tile = z.infer<typeof tileSchema>;
export type Board = z.infer<typeof boardSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Library = z.infer<typeof librarySchema>;
export type BoardChanges = Partial<Pick<Board, 'title' | 'tiles' | 'playLanguages' | 'translateLabels' | 'picturePolicy'>>;
/**
 * Create a normalized source signature that invalidates translations when label, spoken text, or
 * language changes.
 */
export function tileSource(tile: Pick<Tile, 'label' | 'speech' | 'language'>) {
  return JSON.stringify([tile.label.trim().normalize('NFC'), tile.speech.trim().normalize('NFC'), Intl.getCanonicalLocales(tile.language)[0]]);
}

// Deliberately excludes local asset IDs, paths, and image bytes from network requests.
export const boardContextSchema = z.object({
  id: z.string().max(100), revision: z.number().int().nonnegative(), title: z.string().max(100),
  playLanguages: playLanguagesSchema.optional(), picturePolicy: picturePolicySchema.optional(),
  tiles: z.array(z.object({ id: z.string().max(100), label: z.string().max(80), speech: z.string().max(200), language: languageSchema, color: z.enum(colors), emoji: z.string().max(32).nullable(), hasPhoto: z.boolean(), hasPicture: z.boolean().optional(), pictureOptions: pictureOptionsSchema.optional(), languageMode: z.enum(['fixed', 'board']).optional(), translations: z.array(translationSchema).max(6).optional() })).min(1).max(MAX_TILES),
});

// Simple schema for strict Structured Outputs; semantic validation follows parsing.
export const generatedBoardSchema = z.object({
  title: z.string(), explanation: z.string(),
  needsClarification: z.boolean(),
  playLanguages: z.array(z.string()).optional(),
  picturePolicy: picturePolicySchema.optional(),
  tiles: z.array(z.object({ existingId: z.string().nullable(), label: z.string(), speech: z.string(), language: z.string(), emoji: z.string(), color: z.enum(colors), pictureOptions: pictureOptionsSchema.optional(), replacePicture: z.boolean().optional(), languageMode: z.enum(['fixed', 'board']).optional(), translations: z.array(z.object({ language: z.string(), label: z.string(), speech: z.string() })).optional() })),
});
// The API's strict output schema requires every property, while saved/older
// proposal envelopes remain readable without the new optional language fields.
export const aiGeneratedBoardSchema = generatedBoardSchema.omit({ picturePolicy: true }).extend({
  playLanguages: z.array(z.string()),
  tiles: z.array(generatedBoardSchema.shape.tiles.element.omit({ pictureOptions: true, replacePicture: true }).extend({ languageMode: z.enum(['fixed', 'board']), translations: z.array(z.object({ language: z.string(), label: z.string(), speech: z.string() })) })),
});
export const aiPictureGeneratedBoardSchema = aiGeneratedBoardSchema.extend({
  picturePolicy: picturePolicySchema,
  tiles: z.array(aiGeneratedBoardSchema.shape.tiles.element.extend({ pictureInstruction: z.string(), pictureMode: pictureModeSchema.nullable(), pictureStyle: pictureStyleSchema.nullable(), replacePicture: z.boolean() })),
});
export const proposalSchema = z.object({
  baseRevision: z.number().int().nonnegative().nullable(),
  boardId: z.string().nullable(), proposal: generatedBoardSchema,
  pictures: z.array(z.object({ index: z.number().int().min(0).max(MAX_TILES - 1), illustration: illustrationSchema, concept: pictureConceptSchema.optional() })).max(MAX_TILES).optional(),
});
export const MAX_AI_TURNS = 20;
export const conversationTurnSchema = z.object({ prompt: z.string().trim().min(1).max(4000), reply: z.string().trim().min(1).max(1000) });
export const proposalRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000), board: boardContextSchema.nullable(), languageProfile: languageProfileSchema.optional(),
  picturePolicy: picturePolicySchema.optional(), pictureCapability: z.literal(1).optional(),
  // The source board stays immutable until Apply. Draft IDs always refer to it,
  // so a refinement cannot accidentally reuse a replaced tile's photo.
  conversation: z.object({ history: z.array(conversationTurnSchema).max(MAX_AI_TURNS - 1), draft: generatedBoardSchema.nullable() }).optional(),
}).superRefine((request, ctx) => {
  if (!request.conversation?.draft) return;
  try {
    if (request.conversation.draft.needsClarification) throw new Error('Expected a complete draft.');
    validateGeneratedBoard(request.conversation.draft, request.board);
  } catch { ctx.addIssue({ code: 'custom', message: 'The conversation draft is invalid for this board.', path: ['conversation', 'draft'] }); }
});
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;
export type BoardContext = z.infer<typeof boardContextSchema>;
export type ProposalRequest = z.infer<typeof proposalRequestSchema>;
export type GeneratedBoard = z.infer<typeof generatedBoardSchema>;
export type BoardProposal = z.infer<typeof proposalSchema>;

/** Build AI-safe board context without local photo IDs, paths, or bytes, excluding stale translations. */
export function boardContext(board: Board): BoardContext {
  return { id: board.id, title: board.title, revision: board.revision, playLanguages: board.playLanguages ?? [], picturePolicy: board.picturePolicy, tiles: board.tiles.map(t => ({ id: t.id, label: t.label, speech: t.speech, language: t.language, color: t.color, emoji: t.illustration.kind === 'emoji' ? t.illustration.emoji : null, hasPhoto: t.illustration.kind === 'photo', hasPicture: t.illustration.kind !== 'emoji', pictureOptions: t.pictureOptions, languageMode: t.languageMode, translations: t.translations?.filter(translation => translation.source === tileSource(t)).map(({ source, origin, ...translation }) => translation) })) };
}

/**
 * Validate a draft against the source board, rejecting invalid references and content; clarification
 * replies return no tiles.
 */
export function validateGeneratedBoard(value: GeneratedBoard, context: BoardContext | null): GeneratedBoard {
  generatedBoardSchema.parse(value);
  if (!value.explanation.trim() || value.explanation.length > 1000) throw new Error('The board reply was empty or too long. Please try again.');
  if (value.needsClarification) {
    if (!value.explanation.trim()) throw new Error('The board request needs more detail.');
    return { ...value, tiles: [] };
  }
  if (!value.title.trim() || value.title.length > 100 || value.tiles.length < 1 || value.tiles.length > MAX_TILES) throw new Error('The proposed board must contain 1–24 tiles and a title.');
  if (value.playLanguages) playLanguagesSchema.parse(value.playLanguages);
  const seen = new Set<string>();
  for (const tile of value.tiles) {
    const previous = context?.tiles.find(t => t.id === tile.existingId);
    if (tile.existingId !== null) {
      if (!previous || seen.has(tile.existingId)) throw new Error('The proposed edit contained an invalid tile reference.');
      seen.add(tile.existingId);
    }
    // Photo cards keep their local illustration; the model cannot see its asset
    // and may return an empty (unused) emoji. Replacements still need an emoji.
    z.string().max(32).parse(tile.emoji);
    const illustration = previous?.hasPhoto || previous?.hasPicture ? { kind: 'photo', assetId: 'retained', zoom: 1, x: 0, y: 0 } : { kind: 'emoji', emoji: tile.emoji };
    tileSchema.parse({ ...tile, translations: tile.translations?.map(translation => ({ ...translation, source: tileSource(tile) })), id: tile.existingId ?? 'new', illustration });
    if (tile.translations && new Set(tile.translations.map(t => Intl.getCanonicalLocales(t.language)[0])).size !== tile.translations.length) throw new Error('A tile has duplicate translations.');
  }
  return value;
}

/** Reject source changes hiding saved corrections or protected translations supplied from a manual editor draft. */
export function assertTranslationSourceLanguageChange(previous: Tile | undefined, next: Pick<Tile, 'language'>, draftTranslations: Tile['translations'] = []): void {
  const changesLanguage = previous && Intl.getCanonicalLocales(previous.language)[0] !== Intl.getCanonicalLocales(next.language)[0];
  if (changesLanguage && [...(previous.translations ?? []), ...draftTranslations].some(saved => saved.origin !== 'generated' && Intl.getCanonicalLocales(saved.language)[0] === Intl.getCanonicalLocales(next.language)[0])) {
    throw new Error('This changes the original language to one with saved translations. Keep the original language and edit its translation instead, so saved corrections stay protected.');
  }
}

/**
 * Apply a revision-bound proposal, preserving saved corrections (including stale words for review).
 * Only a separate parent review may enable replaceTranslations; never derive it from model output.
 * Reject source-language changes that would shadow a protected saved translation.
 */
export function applyProposal(current: Board | null, envelope: BoardProposal, id: () => string, now = new Date().toISOString(), replaceTranslations = false): Board {
  proposalSchema.parse(envelope);
  if (envelope.pictures && (new Set(envelope.pictures.map(picture => picture.index)).size !== envelope.pictures.length || envelope.pictures.some(picture => picture.index >= envelope.proposal.tiles.length))) throw new Error('The picture draft no longer matches these cards.');
  if (current ? (envelope.boardId !== current.id || envelope.baseRevision !== current.revision) : (envelope.boardId !== null || envelope.baseRevision !== null)) throw new Error('This board changed while AI was working. Generate a new proposal to keep your latest edits.');
  const proposal = validateGeneratedBoard(envelope.proposal, current ? boardContext(current) : null);
  if (proposal.needsClarification) throw new Error(proposal.explanation);
  return boardSchema.parse({
    id: current?.id ?? id(), title: proposal.title, revision: (current?.revision ?? -1) + 1,
    createdAt: current?.createdAt ?? now, updatedAt: now,
    ...(proposal.playLanguages ? { playLanguages: proposal.playLanguages } : current?.playLanguages ? { playLanguages: current.playLanguages } : {}),
    ...(current?.translateLabels !== undefined ? { translateLabels: current.translateLabels } : {}),
    ...(proposal.picturePolicy ? { picturePolicy: proposal.picturePolicy } : current?.picturePolicy ? { picturePolicy: current.picturePolicy } : {}),
    tiles: proposal.tiles.map((tile, index) => {
      const previous = current?.tiles.find(t => t.id === tile.existingId);
      const source = tileSource(tile);
      assertTranslationSourceLanguageChange(previous, tile);
      const translations = [...(previous?.translations ?? [])];
      for (const proposed of tile.translations ?? []) {
        const index = translations.findIndex(t => Intl.getCanonicalLocales(t.language)[0] === Intl.getCanonicalLocales(proposed.language)[0]);
        const old = translations[index];
        if (old && old.source === source && old.label === proposed.label && old.speech === proposed.speech) continue;
        // Model output cannot grant permission to replace a parent's correction.
        if (old && old.origin !== 'generated' && !replaceTranslations) continue;
        const next = { ...proposed, source, origin: 'generated' as const };
        if (index < 0) translations.push(next); else translations[index] = next;
      }
      if (translations.length > 6) throw new Error('This proposal exceeds the saved translation limit. Keep fewer new languages; existing translations have not been removed.');
      const languageMode = tile.languageMode ?? previous?.languageMode;
      const picture = envelope.pictures?.find(value => value.index === index);
      const retainedIllustration = previous && !tile.replacePicture && (proposal.picturePolicy || previous.illustration.kind !== 'emoji' || previous.pictureOptions?.locked) ? previous.illustration : undefined;
      return { id: previous?.id ?? id(), label: tile.label, speech: tile.speech, language: tile.language, color: tile.color,
        ...(languageMode ? { languageMode } : {}), ...(translations.length ? { translations } : {}),
        pictureOptions: tile.pictureOptions ?? previous?.pictureOptions,
        pictureConcept: picture?.concept ?? previous?.pictureConcept,
        illustration: picture?.illustration ?? retainedIllustration ?? { kind: 'emoji', emoji: tile.emoji || '❔' } };
    }),
  });
}

/** List protected translations that a proposal would replace after an explicit parent review. */
export function proposalTranslationReplacements(current: Board | undefined, envelope: BoardProposal) {
  return envelope.proposal.tiles.flatMap(tile => {
    const previous = current?.tiles.find(value => value.id === tile.existingId);
    return (tile.translations ?? []).flatMap(proposed => {
      const saved = previous?.translations?.find(value => Intl.getCanonicalLocales(value.language)[0] === Intl.getCanonicalLocales(proposed.language)[0]);
      return saved && saved.origin !== 'generated' && (saved.source !== tileSource(tile) || saved.label !== proposed.label || saved.speech !== proposed.speech)
        ? [{ tileId: previous!.id, card: tile.label, saved, proposed }] : [];
    });
  });
}

/**
 * Apply and validate board changes while incrementing the revision and updating the modification
 * timestamp.
 */
export function reviseBoard(board: Board, changes: BoardChanges): Board {
  return boardSchema.parse({ ...board, ...changes, revision: board.revision + 1, updatedAt: new Date().toISOString() });
}

/**
 * Validate the supported durable library format; reject unknown or corrupt data instead of silently
 * resetting it.
 */
export function migrateLibrary(raw: unknown): Library {
  // v2 adds image assets without rewriting the appearance of any saved board.
  if (raw && typeof raw === 'object' && 'version' in raw && raw.version === 1) return librarySchema.parse({ ...raw, version: 2 });
  return librarySchema.parse(raw);
}
