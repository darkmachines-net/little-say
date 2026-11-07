/** @file Verifies server seed recordings cover the exact vocabulary and match their PCM format, digests, profile, and prompt source. */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { createStarterBoards } from '@little-say/core/starterBoards';
import { speechProfile } from '../src/synthesis';
import manifest from '../seeds/speech/manifest.json';

const tiles = createStarterBoards(() => 'fixture').flatMap(board => board.tiles);
const assets = new URL('../seeds/speech/audio/', import.meta.url);

it('ships a non-silent, digest-verified Marin clip for every starter word and no extra words', async () => {
  expect(manifest.profile).toEqual(speechProfile({ NODE_ENV: 'test' }));
  const instructions = JSON.parse(await readFile(new URL('../../../prompts/server/speech.json', import.meta.url), 'utf8'));
  expect(manifest.instructionsDigest).toBe(createHash('sha256').update(JSON.stringify(instructions)).digest('hex'));
  expect(manifest.clips.map(clip => [clip.text, clip.language])).toEqual(tiles.map(tile => [tile.speech, tile.language]));
  expect((await readdir(assets)).sort()).toEqual(manifest.clips.map(clip => `${clip.id}.wav`).sort());
  let total = 0;
  for (const clip of manifest.clips) {
    const bytes = await readFile(new URL(`${clip.id}.wav`, assets));
    total += bytes.length;
    expect(bytes.length).toBe(clip.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(clip.id);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(bytes.readUInt16LE(20)).toBe(1); expect(bytes.readUInt16LE(22)).toBe(1);
    expect(bytes.readUInt32LE(24)).toBe(24000); expect(bytes.readUInt16LE(34)).toBe(16);
    expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44);
    expect(bytes.length).toBeGreaterThan(4844);
    let peak = 0;
    for (let offset = 44; offset < bytes.length; offset += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)));
    expect(peak).toBeGreaterThan(100);
  }
  expect(total).toBeLessThan(2_000_000);
});
