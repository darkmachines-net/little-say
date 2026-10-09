/** @file Locks starter prompts and conversation presets to their exact pre-extraction text. */

import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { starterPrompt, starterTopics } from '../../../packages/core/src/onboarding';
import { conversationPrompts } from '../../../packages/core/src/promptPresets';

it('preserves all starter topics and the separate conversation wording', () => {
  const conversation = [conversationPrompts.farm, conversationPrompts.snack, conversationPrompts.family];
  const values = { topics: starterTopics, starters: starterTopics.map(topic => starterPrompt(topic.id)), conversation };
  expect(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, createHash('sha256').update(JSON.stringify(value)).digest('hex')]))).toMatchSnapshot();
});
