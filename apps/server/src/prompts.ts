/** @file Loads server-only JSON prompts into source execution and the self-contained Node ESM bundle. */

import board from '../../../prompts/server/board.json' with { type: 'json' };
import pictures from '../../../prompts/server/pictures.json' with { type: 'json' };
import speech from '../../../prompts/server/speech.json' with { type: 'json' };
import preparation from '../../../prompts/server/preparation.json' with { type: 'json' };
import { loadPromptResource, loadPromptTemplate } from '../../../packages/core/src/promptResources';
import { type PictureConcept } from '@little-say/core';

export const boardPrompts = loadPromptResource(board, ['instructions', 'pictures', 'translation'], 'server/board');
export const picturePrompts = loadPromptResource(pictures, ['visualRules', 'analysis', 'selection', 'review', 'color', 'line', 'generation'], 'server/pictures');
export const preparationPrompts = loadPromptResource(preparation, ['draft', 'concepts', 'templates', 'matching', 'batch'], 'server/preparation');
const preparationConcepts = loadPromptTemplate(preparationPrompts.concepts, ['concepts'], 'server/preparation.concepts');
const speechPrompts = loadPromptResource(speech, ['instructions'], 'server/speech');
export const pictureSelectionInstructions = loadPromptTemplate(picturePrompts.selection, ['visualRules'], 'server/pictures.selection')({ visualRules: picturePrompts.visualRules });
export const pictureReviewInstructions = loadPromptTemplate(picturePrompts.review, ['visualRules'], 'server/pictures.review')({ visualRules: picturePrompts.visualRules });
const generation = loadPromptTemplate(picturePrompts.generation, ['look', 'concept'], 'server/pictures.generation');
const speechText = loadPromptTemplate(speechPrompts.instructions, ['language'], 'server/speech.instructions');

/** Insert only the server-owned canonical vocabulary into the combined draft instructions. */
export function preparationConceptInstructions(concepts: string[]): string { return preparationConcepts({ concepts: concepts.join(', ') }); }

/** Assemble illustration instructions with the original JSON serialization and literal concept data. */
export function pictureGenerationPrompt(look: string, concept: PictureConcept): string {
  return generation({ look, concept: JSON.stringify(concept) });
}

/** Insert the language tag once; preserve any template-looking data rather than interpreting it. */
export function speechInstructions(language: string): string {
  return speechText({ language });
}
