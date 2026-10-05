/** @file Defines picture preferences, safe catalog/job contracts, and board-wide visual selection rules. */

import { z } from 'zod';

export const pictureModeSchema = z.enum(['auto', 'library', 'generated', 'emoji']);
export const pictureStyleSchema = z.enum(['color', 'line']);
export const picturePolicySchema = z.object({ mode: pictureModeSchema, style: pictureStyleSchema, consistent: z.boolean() });
export type PicturePolicy = z.infer<typeof picturePolicySchema>;
export const defaultPicturePolicy: PicturePolicy = { mode: 'auto', style: 'color', consistent: false };
export const pictureOptionsSchema = z.object({ locked: z.boolean(), instruction: z.string().max(500), mode: pictureModeSchema.optional(), style: pictureStyleSchema.optional() });
export const pictureConceptSchema = z.object({ description: z.string().min(1).max(300), features: z.array(z.string().min(1).max(100)).max(8), searchTerms: z.array(z.string().min(1).max(80)).min(1).max(6), emojiAccurate: z.boolean() });
export type PictureConcept = z.infer<typeof pictureConceptSchema>;
export const pictureAssetIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const pictureProvenanceSchema = z.object({ library: z.enum(['mulberry', 'openmoji']), sourceId: z.string().max(150), sourceUrl: z.string().url().max(500), author: z.string().max(200), license: z.literal('CC-BY-SA-4.0'), modified: z.string().max(200) });
export const libraryPictureSchema = z.object({ kind: z.literal('library'), assetId: pictureAssetIdSchema, style: pictureStyleSchema, provenance: pictureProvenanceSchema });
export const generatedPictureSchema = z.object({ kind: z.literal('generated'), assetId: pictureAssetIdSchema, style: pictureStyleSchema, description: z.string().max(800), model: z.string().max(100) });
export const unresolvedPictureSchema = z.object({ kind: z.literal('unresolved'), reason: z.string().min(1).max(300) });
export const resolvedPictureSchema = z.discriminatedUnion('kind', [libraryPictureSchema, generatedPictureSchema, unresolvedPictureSchema]);
export type ResolvedPicture = z.infer<typeof resolvedPictureSchema>;
export const catalogEntrySchema = z.object({ id: z.string().max(150), name: z.string().max(150), terms: z.array(z.string()), style: pictureStyleSchema, provenance: pictureProvenanceSchema });
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
export const pictureAnalysisRequestSchema = z.object({
  tiles: z.array(z.object({ id: z.string().max(100), label: z.string().min(1).max(80), language: z.string().max(35), emoji: z.string().max(32), instruction: z.string().max(500) })).min(1).max(24),
});
export type PictureAnalysisRequest = z.infer<typeof pictureAnalysisRequestSchema>;
export const pictureAnalysisSchema = z.object({ tiles: z.array(z.object({ id: z.string(), emoji: z.string().min(1).max(32), concept: pictureConceptSchema })) });
export const pictureJobRequestSchema = z.object({
  requestId: z.string().uuid(), draftId: z.string().max(100), tileId: z.string().max(100), concept: pictureConceptSchema,
  style: pictureStyleSchema, mode: z.enum(['auto', 'library', 'generated']), allowGeneration: z.boolean(), regenerate: z.boolean(),
  neighbors: z.array(z.string().max(300)).max(23),
});
export type PictureJobRequest = z.infer<typeof pictureJobRequestSchema>;
export const pictureJobSchema = z.object({ id: z.string().uuid(), draftId: z.string(), tileId: z.string(), state: z.enum(['queued', 'working', 'complete', 'cancelled', 'error']), phase: z.enum(['finding', 'generating']).optional(), result: resolvedPictureSchema.optional(), error: z.string().optional() });
export type PictureJob = z.infer<typeof pictureJobSchema>;

/** Normalize presentation selectors so visually identical emoji are compared together. */
export function normalizedEmoji(value: string): string { return value.replace(/[\uFE0E\uFE0F]/g, '').normalize('NFC'); }

/** Decide which unprotected cards need illustrations; Automatic fills only gaps, including for legacy consistent=true preferences. */
export function pictureTargets(tiles: { id: string; emoji: string; concept: PictureConcept; locked: boolean; mode?: PicturePolicy['mode'] }[], policy: PicturePolicy): Set<string> {
  const weak = new Set(tiles.filter(tile => !tile.concept.emojiAccurate || tiles.some(other => other.id !== tile.id && normalizedEmoji(other.emoji) === normalizedEmoji(tile.emoji) && other.concept.description.toLowerCase() !== tile.concept.description.toLowerCase())).map(tile => tile.id));
  return new Set(tiles.filter(tile => !tile.locked && (tile.mode ?? policy.mode) !== 'emoji' && ((tile.mode ?? policy.mode) !== 'auto' || weak.has(tile.id))).map(tile => tile.id));
}
