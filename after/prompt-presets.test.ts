import { writeFileSync as saveCapture } from 'node:fs';
/** @file Locks starter prompts and conversation presets to their exact pre-extraction text. */

import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { starterPrompt, starterTopics } from './onboarding';
import { conversationPrompts } from './promptPresets';

it('preserves all starter topics and the separate conversation wording', () => {
  const conversation = [conversationPrompts.farm, conversationPrompts.snack, conversationPrompts.family];
  const values = { topics: starterTopics, starters: starterTopics.map(topic => starterPrompt(topic.id)), conversation };
  saveCapture("C:\\Users\\MChar\\Documents\\Codex\\2026-10-06\\task-12\\evidence\\after\\presets.json", JSON.stringify(values, null, 2) + '\n'); expect(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, createHash('sha256').update(JSON.stringify(value)).digest('hex')]))).toMatchSnapshot();
});
