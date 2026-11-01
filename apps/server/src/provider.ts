/**
 * @file Requests structured OpenAI boards and translations, normalizing picture choices for both
 * synchronous proposals and prepared drafts.
 */

import { boardPrompts, picturePrompts, preparationPrompts } from './prompts';
import { genericConceptInstructions } from './generic-concepts';
import { draftFailure, draftRequestId, DraftResponseError, type DraftMetric } from './draft-diagnostics';
import OpenAI from 'openai';
import { type z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { aiGeneratedBoardSchema, aiPictureGeneratedBoardSchema, aiPreparedBoardSchema, generatedTranslationsSchema, type GeneratedBoard, type ProposalRequest, type TranslationRequest, type GeneratedTranslations } from '@little-say/core';

export interface AiProvider {
  /**
   * Generate a structured board draft or clarification from the parent prompt and optional conversation
   * context.
   */
  propose(request: ProposalRequest): Promise<GeneratedBoard>;
  /** Produce words and concepts in one cancellable call; templates are sanitized server-owned hints. */
  prepare?(request: ProposalRequest, templates: GeneratedBoard[], signal?: AbortSignal): Promise<GeneratedBoard>;
  /** Generate the requested tile-language pairs when translation is supported by the provider. */
  translate?(request: TranslationRequest): Promise<GeneratedTranslations>;
}

// Both board protocols use the same picture protection rules and always create color artwork.
function normalizePictureDraft(draft: z.infer<typeof aiPictureGeneratedBoardSchema>, request: ProposalRequest): GeneratedBoard {
  return {
    ...draft,
    picturePolicy: { ...draft.picturePolicy, style: 'color' },
    tiles: draft.tiles.map(({ pictureInstruction, pictureMode, pictureStyle: _style, replacePicture, ...tile }) => {
      const previous = request.conversation?.draft?.tiles.find(value => value.existingId !== null && value.existingId === tile.existingId)
        ?? request.board?.tiles.find(value => value.id === tile.existingId);
      return {
        ...tile,
        replacePicture,
        pictureOptions: {
          locked: replacePicture ? Boolean(pictureInstruction || pictureMode) : previous?.pictureOptions?.locked ?? false,
          instruction: pictureInstruction,
          ...(pictureMode ? { mode: pictureMode } : {}),
        },
      };
    }),
  };
}

/**
 * Create the OpenAI-backed provider from server environment settings, or return null when no API key is
 * configured. Preparation metrics report bounded failure stages and token usage without request or
 * response content; transport and structured-output parsing are measured separately without retries.
 * Initial preparation uses OPENAI_DRAFT_MODEL (gpt-6-luna) and OPENAI_DRAFT_REASONING_EFFORT (none).
 * Refinements and translations retain OPENAI_BOARD_MODEL and OPENAI_REASONING_EFFORT.
 */
export function openAIProvider(env: NodeJS.ProcessEnv, metric?: (event: DraftMetric) => void): AiProvider | null {
  const apiKey = env.AAC_OPENAI_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey, timeout: 45000, maxRetries: 0 });
  return {
    async prepare(request, templates, signal) {
      const started = Date.now();
      const initial = !request.board && !request.conversation?.draft && !request.conversation?.history.length;
      const model = initial ? env.OPENAI_DRAFT_MODEL || 'gpt-6-luna' : env.OPENAI_BOARD_MODEL || 'gpt-6.1-sol';
      const effort = initial ? env.OPENAI_DRAFT_REASONING_EFFORT || 'none' : env.OPENAI_REASONING_EFFORT || 'low';
      const { preparationId: _id, previousPreparationId: _previous, ...input } = request;
      let stage = 'request';
      let usage: { inputTokens: number; outputTokens: number } | undefined;
      try {
        // Separate transport from local parsing so failed structured output is not mislabeled as an outage.
        const response = await client.responses.create({ model, reasoning: { effort: effort as 'none' | 'low' | 'medium' | 'high' }, store: false, max_output_tokens: 14000,
          input: [{ role: 'system', content: boardPrompts.instructions + boardPrompts.pictures + '\n' + picturePrompts.analysis + preparationPrompts.draft + genericConceptInstructions() + preparationPrompts.templates },
            { role: 'user', content: JSON.stringify({ request: input, templates }) }],
          text: { format: zodTextFormat(aiPreparedBoardSchema, 'prepared_soundboard') },
        }, { signal });
        usage = { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 };
        stage = 'response';
        if (response.status !== 'completed') throw new DraftResponseError('incomplete');
        if (response.output.some(item => item.type === 'message' && item.content.some(content => content.type === 'refusal'))) throw new DraftResponseError('refusal');
        if (!response.output_text) throw new DraftResponseError('incomplete');
        stage = 'json'; const decoded: unknown = JSON.parse(response.output_text);
        stage = 'schema'; const draft = aiPreparedBoardSchema.parse(decoded);
        stage = 'normalize';
        const result = normalizePictureDraft(draft, request);
        metric?.({ operation: initial ? 'draft' : 'refine', milliseconds: Date.now() - started, ...usage, requestId: draftRequestId(request.preparationId), outcome: 'success' });
        return result;
      } catch (error) {
        metric?.({ operation: initial ? 'draft' : 'refine', milliseconds: Date.now() - started, ...usage, requestId: draftRequestId(request.preparationId), outcome: 'failure', stage, failure: draftFailure(error, signal?.aborted) });
        throw error;
      }
    },
    async propose(request) {
      if (request.pictureCapability === 1) {
        const response = await client.responses.parse({
          model: env.OPENAI_BOARD_MODEL || 'gpt-6.1-sol', reasoning: { effort: (env.OPENAI_REASONING_EFFORT || 'low') as 'low' | 'medium' | 'high' },
          store: false, max_output_tokens: 14000,
          input: [{ role: 'system', content: boardPrompts.instructions + boardPrompts.pictures }, { role: 'user', content: JSON.stringify(request) }],
          text: { format: zodTextFormat(aiPictureGeneratedBoardSchema, 'picture_soundboard') },
        });
        const draft = response.output_parsed;
        if (!draft || response.status !== 'completed') throw new Error('Incomplete board draft.');
        return normalizePictureDraft(draft, request);
      }
      const response = await client.responses.parse({
        model: env.OPENAI_BOARD_MODEL || 'gpt-6.1-sol',
        reasoning: { effort: (env.OPENAI_REASONING_EFFORT || 'low') as 'low' | 'medium' | 'high' },
        store: false, max_output_tokens: 12000,
        input: [{ role: 'system', content: boardPrompts.instructions }, { role: 'user', content: JSON.stringify(request) }],
        text: { format: zodTextFormat(aiGeneratedBoardSchema, 'soundboard') },
      });
      if (!response.output_parsed || response.status !== 'completed') throw new Error('The model did not return a complete board.');
      return response.output_parsed;
    },
    async translate(request) {
      const response = await client.responses.parse({
        model: env.OPENAI_BOARD_MODEL || 'gpt-6.1-sol',
        reasoning: { effort: (env.OPENAI_REASONING_EFFORT || 'low') as 'low' | 'medium' | 'high' },
        store: false, max_output_tokens: 12000,
        input: [{ role: 'system', content: boardPrompts.translation }, { role: 'user', content: JSON.stringify(request) }],
        text: { format: zodTextFormat(generatedTranslationsSchema, 'translations') },
      });
      if (!response.output_parsed || response.status !== 'completed') throw new Error('Incomplete translations.');
      return response.output_parsed;
    },
  };
}
