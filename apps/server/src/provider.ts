/**
 * @file Implements server-side OpenAI board proposals, transcription, and translation behind an
 * injectable provider.
 */

import { boardPrompts } from './prompts';
import OpenAI, { toFile } from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { aiGeneratedBoardSchema, aiPictureGeneratedBoardSchema, generatedTranslationsSchema, type GeneratedBoard, type ProposalRequest, type TranslationRequest, type GeneratedTranslations } from '@little-say/core';

export interface AiProvider {
  /**
   * Generate a structured board draft or clarification from the parent prompt and optional conversation
   * context.
   */
  propose(request: ProposalRequest): Promise<GeneratedBoard>;
  /**
   * Convert the supplied recording bytes and file metadata into prompt text in the original spoken
   * languages.
   */
  transcribe(audio: Buffer, filename: string, mime: string): Promise<string>;
  /** Generate the requested tile-language pairs when translation is supported by the provider. */
  translate?(request: TranslationRequest): Promise<GeneratedTranslations>;
}

export const boardInstructions = boardPrompts.instructions;

const pictureInstructions = boardPrompts.pictures;

/**
 * Create the OpenAI-backed provider from server environment settings, or return null when no API key is
 * configured.
 */
export function openAIProvider(env: NodeJS.ProcessEnv): AiProvider | null {
  const apiKey = env.AAC_OPENAI_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey, timeout: 45000, maxRetries: 0 });
  return {
    async propose(request) {
      if (request.pictureCapability === 1) {
        const response = await client.responses.parse({
          model: env.OPENAI_BOARD_MODEL || 'gpt-6.1-sol', reasoning: { effort: (env.OPENAI_REASONING_EFFORT || 'low') as 'low' | 'medium' | 'high' },
          store: false, max_output_tokens: 14000,
          input: [{ role: 'system', content: boardInstructions + pictureInstructions }, { role: 'user', content: JSON.stringify(request) }],
          text: { format: zodTextFormat(aiPictureGeneratedBoardSchema, 'picture_soundboard') },
        });
        const draft = response.output_parsed;
        if (!draft || response.status !== 'completed') throw new Error('Incomplete board draft.');
        return { ...draft, picturePolicy: { ...draft.picturePolicy, style: 'color' }, tiles: draft.tiles.map(({ pictureInstruction, pictureMode, pictureStyle: _style, replacePicture, ...tile }) => {
          const previous = request.conversation?.draft?.tiles.find(value => value.existingId !== null && value.existingId === tile.existingId) ?? request.board?.tiles.find(value => value.id === tile.existingId);
          return { ...tile, replacePicture, pictureOptions: { locked: replacePicture ? Boolean(pictureInstruction || pictureMode) : previous?.pictureOptions?.locked ?? false, instruction: pictureInstruction, ...(pictureMode ? { mode: pictureMode } : {}) } };
        }) };
      }
      const response = await client.responses.parse({
        model: env.OPENAI_BOARD_MODEL || 'gpt-6.1-sol',
        reasoning: { effort: (env.OPENAI_REASONING_EFFORT || 'low') as 'low' | 'medium' | 'high' },
        store: false, max_output_tokens: 12000,
        input: [{ role: 'system', content: boardInstructions }, { role: 'user', content: JSON.stringify(request) }],
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
    async transcribe(audio, filename, mime) {
      const result = await client.audio.transcriptions.create({
        model: env.OPENAI_TRANSCRIBE_MODEL || 'gpt-transcribe',
        file: await toFile(audio, filename, { type: mime }),
        prompt: boardPrompts.transcription,
      });
      return result.text;
    },
  };
}
