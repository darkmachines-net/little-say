import { writeFileSync as saveCapture, readFileSync } from 'node:fs';
/** @file Locks starter prompts and conversation presets to their exact pre-extraction text. */

import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { starterPrompt, starterTopics } from '../../../packages/core/src/onboarding';
import { conversationPrompts } from '../../../packages/core/src/promptPresets';

it('preserves all starter topics and the separate conversation wording', () => {
  const conversation = [conversationPrompts.farm, conversationPrompts.snack, conversationPrompts.family];
  const values = { topics: starterTopics, starters: starterTopics.map(topic => starterPrompt(topic.id)), conversation };
  saveCapture("C:\\Users\\MChar\\Documents\\Codex\\2026-10-08\\task-9\\evidence-integration\\after\\presets.json", JSON.stringify(values, null, 2) + '\n');
});
