/** @file Imports prepared starter pronunciations into the ordinary shared speech cache and marks those vocabulary clips public. */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { createStarterBoards, speechKey } from '@little-say/core';
import { DatabaseCache, type ObjectStore } from './hosting/storage';
import { SpeechCache } from './speech-cache';
import manifest from '../seeds/speech/manifest.json';

/**
 * Seed missing starter clips without provider calls, using normal speech identity, media records,
 * and download grants. Existing valid takes survive repeated initialization; the caller owns storage.
 */
export async function seedStarterSpeech(pool: Pool, objects: ObjectStore) {
  const vocabulary = createStarterBoards(() => 'seed').flatMap(board => board.tiles.map(tile => ({ text: tile.speech, language: tile.language })));
  const clips = new Map(manifest.clips.map(clip => [speechKey(clip), clip]));
  if (clips.size !== vocabulary.length || vocabulary.some(input => !clips.has(speechKey(input)))) throw new Error('Speech seeds must match the starter vocabulary.');
  const cache = new SpeechCache(new DatabaseCache(pool, objects, 'speech', undefined, true), manifest.profile, async input => {
    const clip = clips.get(speechKey(input));
    if (!clip || !/^[a-f0-9]{64}$/.test(clip.id)) throw new Error('Unknown speech seed.');
    const audio = await readFile(new URL(`../seeds/speech/audio/${clip.id}.wav`, import.meta.url));
    if (audio.length !== clip.bytes || createHash('sha256').update(audio).digest('hex') !== clip.id) throw new Error('Speech seed integrity check failed.');
    return audio;
  });
  for (const input of vocabulary) await cache.get(input);
  return vocabulary.length;
}
