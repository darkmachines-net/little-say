import { writeFileSync as saveCapture } from 'node:fs';
/** @file Locks starter prompts and conversation presets to their exact pre-extraction text. */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { starterPrompt, starterTopics } from './onboarding';

it('preserves all starter topics and the separate conversation wording', () => {
  const mobile = readFileSync(new URL('../../../apps/mobile/src/ui/AiConversation.tsx', import.meta.url), 'utf8');
  const conversation = Array.from(mobile.matchAll(/'(Create six [^']+)'/g), match => match[1]);
  const values = { topics: starterTopics, starters: starterTopics.map(topic => starterPrompt(topic.id)), conversation };
  saveCapture("C:\\Users\\MChar\\Documents\\Codex\\2026-10-06\\task-12\\evidence\\before\\presets.json", JSON.stringify(values, null, 2) + '\n'); expect(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, createHash('sha256').update(JSON.stringify(value)).digest('hex')]))).toMatchSnapshot();
});
