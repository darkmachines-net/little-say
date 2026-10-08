import { writeFileSync as saveCapture, readFileSync } from 'node:fs';
/** @file Locks starter prompts and conversation presets to their exact pre-extraction text. */

import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { starterPrompt, starterTopics } from '../../../packages/core/src/onboarding';


it('preserves all starter topics and the separate conversation wording', () => {
  const mobile = readFileSync("C:\\Users\\MChar\\Documents\\Codex\\2026-10-08\\task-9\\baseline-master\\apps\\mobile\\src\\ui\\AiConversation.tsx", 'utf8'); const conversation = Array.from(mobile.matchAll(/'(Create six [^']+)'/g), match => match[1]); expect(conversation).toHaveLength(3);
  const values = { topics: starterTopics, starters: starterTopics.map(topic => starterPrompt(topic.id)), conversation };
  saveCapture("C:\\Users\\MChar\\Documents\\Codex\\2026-10-08\\task-9\\evidence-integration\\before\\presets.json", JSON.stringify(values, null, 2) + '\n');
});
