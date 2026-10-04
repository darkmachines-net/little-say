/**
 * @file Defines speech payload validation and normalized text/language identity shared by client and
 * server.
 */

import { z } from 'zod';
import { languageSchema } from './schema';

export const speechInputSchema = z.object({
  text: z.string().trim().min(1).max(200).transform(text => text.normalize('NFC')),
  language: languageSchema.transform(tag => Intl.getCanonicalLocales(tag)[0]),
});
export const speechRequestSchema = speechInputSchema.extend({ regenerate: z.boolean().default(false) });
export const speechAssetIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const speechResponseSchema = speechInputSchema.extend({ id: speechAssetIdSchema, cacheHit: z.boolean() });
export type SpeechInput = z.infer<typeof speechInputSchema>;
export type SpeechAsset = { id: string; uri: string };
/** Validate and normalize spoken text and language into a stable key for equivalent pronunciations. */
export function speechKey(input: SpeechInput): string {
  const value = speechInputSchema.parse(input);
  return JSON.stringify([value.text, value.language]);
}
