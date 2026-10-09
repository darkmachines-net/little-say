/** @file Performs concept analysis, pixel-based picture selection, and bounded OpenAI illustration generation. */

import { picturePrompts, pictureSelectionInstructions, pictureReviewInstructions, pictureGenerationPrompt } from './prompts';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { pictureAnalysisSchema, type PictureAnalysisRequest, type PictureConcept, type PicturePolicy } from '@little-say/core';

export interface PictureCandidate { id: string; name: string; bytes: Buffer; }
export interface PictureMetric { operation: 'analyze' | 'select' | 'generate' | 'review'; milliseconds: number; inputTokens: number; outputTokens: number; }
export interface PictureProvider {
  model: string;
  /** Describe requested meanings in English for search while preserving language-independent distinctions. */
  analyze(request: PictureAnalysisRequest): Promise<z.infer<typeof pictureAnalysisSchema>>;
  /** Inspect actual candidate pixels with caller cancellation; null means no suitable picture. */
  select(concept: PictureConcept, candidates: PictureCandidate[], neighbors: string[], signal: AbortSignal): Promise<string | null>;
  /** Generate one picture from a shared style brief; the caller owns cancellation and result validation. */
  generate(concept: PictureConcept, style: PicturePolicy['style'], signal: AbortSignal): Promise<Buffer>;
  /** Inspect a board's actual downloaded images and report cards that are inaccurate or visually ambiguous. */
  review(cards: (PictureCandidate & { concept: PictureConcept })[]): Promise<string[]>;
}
const selectionSchema = z.object({ id: z.string().nullable() });
const reviewSchema = z.object({ rejected: z.array(z.string()) });
const image = (bytes: Buffer): OpenAI.Responses.ResponseInputImage => ({ type: 'input_image', image_url: `data:image/png;base64,${bytes.toString('base64')}`, detail: 'auto' });

/** Build the image provider when a backend key is present; disable generation separately through server configuration. */
export function openAIPictureProvider(env: NodeJS.ProcessEnv, metric?: (event: PictureMetric) => void): PictureProvider | undefined {
  const apiKey = env.AAC_OPENAI_KEY?.trim() || env.OPENAI_API_KEY?.trim(); if (!apiKey) return undefined;
  const client = new OpenAI({ apiKey, timeout: 180000, maxRetries: 0 });
  // Synchronous endpoints must return before the app's 60-second request deadline.
  const synchronousTimeout = 50000;
  const model = env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-flare';
  const boardModel = env.OPENAI_BOARD_MODEL || 'gpt-6.1-sol';
  return {
    model,
    async analyze(request) {
      const started = Date.now();
      const response = await client.responses.parse({ model: boardModel, store: false, max_output_tokens: 7000,
          input: [{ role: 'system', content: picturePrompts.analysis }, { role: 'user', content: JSON.stringify(request) }],
        text: { format: zodTextFormat(pictureAnalysisSchema, 'picture_concepts') },
      }, { timeout: synchronousTimeout });
      const result = response.output_parsed;
      metric?.({ operation: 'analyze', milliseconds: Date.now() - started, inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 });
      if (!result || response.status !== 'completed' || result.tiles.length !== request.tiles.length || new Set(result.tiles.map(tile => tile.id)).size !== result.tiles.length || result.tiles.some(tile => !request.tiles.some(input => input.id === tile.id))) throw new Error('Incomplete picture descriptions.');
      return result;
    },
    async select(concept, candidates, neighbors, signal) {
      if (!candidates.length) return null;
      const started = Date.now();
      const content: OpenAI.Responses.ResponseInputContent[] = [{ type: 'input_text', text: JSON.stringify({ concept, neighbors }) }];
      for (const candidate of candidates) content.push({ type: 'input_text', text: JSON.stringify({ id: candidate.id, name: candidate.name }) }, image(candidate.bytes));
      const result = await client.responses.parse({ model: boardModel, store: false, max_output_tokens: 300, input: [{ role: 'system', content: pictureSelectionInstructions }, { role: 'user', content }], text: { format: zodTextFormat(selectionSchema, 'picture_selection') } }, { signal });
      const id = result.output_parsed?.id;
      metric?.({ operation: 'select', milliseconds: Date.now() - started, inputTokens: result.usage?.input_tokens ?? 0, outputTokens: result.usage?.output_tokens ?? 0 });
      if (result.status !== 'completed' || !result.output_parsed || (id && !candidates.some(candidate => candidate.id === id))) throw new Error('Invalid picture selection.');
      return id ?? null;
    },
    async generate(concept, style, signal) {
      const started = Date.now();
      const look = style === 'color' ? picturePrompts.color : picturePrompts.line;
      const response = await client.images.generate({ model, n: 1, size: '1024x1024', quality: 'medium', background: 'transparent', output_format: 'png', moderation: 'auto', prompt: pictureGenerationPrompt(look, concept) }, { signal });
      const encoded = response.data?.[0]?.b64_json;
      metric?.({ operation: 'generate', milliseconds: Date.now() - started, inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 });
      if (!encoded || encoded.length > 12 * 1024 * 1024) throw new Error('No usable image was returned.');
      return Buffer.from(encoded, 'base64');
    },
    async review(cards) {
      if (!cards.length) return [];
      const started = Date.now();
      const content: OpenAI.Responses.ResponseInputContent[] = [];
      for (const card of cards) content.push({ type: 'input_text', text: JSON.stringify({ id: card.id, concept: card.concept }) }, image(card.bytes));
      const result = await client.responses.parse({ model: boardModel, store: false, max_output_tokens: 1000, input: [{ role: 'system', content: pictureReviewInstructions }, { role: 'user', content }], text: { format: zodTextFormat(reviewSchema, 'picture_review') } }, { timeout: synchronousTimeout });
      if (!result.output_parsed || result.status !== 'completed' || result.output_parsed.rejected.some(id => !cards.some(card => card.id === id))) throw new Error('Picture review unavailable.');
      metric?.({ operation: 'review', milliseconds: Date.now() - started, inputTokens: result.usage?.input_tokens ?? 0, outputTokens: result.usage?.output_tokens ?? 0 });
      return result.output_parsed.rejected;
    },
  };
}
