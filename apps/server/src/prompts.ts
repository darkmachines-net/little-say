/** @file Loads server-only JSON prompts into source execution and the self-contained Node ESM bundle. */

import board from '../../../prompts/server/board.json';
import pictures from '../../../prompts/server/pictures.json';
import speech from '../../../prompts/server/speech.json';
import { loadPromptResource, loadPromptTemplate, type PictureConcept } from '@little-say/core';

export const boardPrompts = loadPromptResource(board, ['instructions', 'pictures', 'translation', 'transcription'], 'server/board');
export const picturePrompts = loadPromptResource(pictures, ['visualRules', 'analysis', 'selection', 'review', 'color', 'line', 'generation'], 'server/pictures');
const speechPrompts = loadPromptResource(speech, ['instructions'], 'server/speech');
export const pictureSelectionInstructions = loadPromptTemplate(picturePrompts.selection, ['visualRules'], 'server/pictures.selection')({ visualRules: picturePrompts.visualRules });
export const pictureReviewInstructions = loadPromptTemplate(picturePrompts.review, ['visualRules'], 'server/pictures.review')({ visualRules: picturePrompts.visualRules });
const generation = loadPromptTemplate(picturePrompts.generation, ['look', 'concept'], 'server/pictures.generation');
const speechText = loadPromptTemplate(speechPrompts.instructions, ['language'], 'server/speech.instructions');

/** Assemble illustration instructions with the original JSON serialization and literal concept data. */
export function pictureGenerationPrompt(look: string, concept: PictureConcept): string {
  return generation({ look, concept: JSON.stringify(concept) });
}

/** Insert the language tag once; preserve any template-looking data rather than interpreting it. */
export function speechInstructions(language: string): string {
  return speechText({ language });
}
