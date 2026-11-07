/** @file Verifies shipped AI audio covers the exact starter vocabulary, matches its digests/profile, and stays outside JavaScript. */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { createStarterBoards } from '@little-say/core/starterBoards';
import { speechProfile } from '../../../../server/src/synthesis';
import { starterAudioAsset } from './starterAudio';
import manifest from './manifest.json';

const tiles = createStarterBoards(() => 'fixture').flatMap(board => board.tiles);
const assets = new URL('../../../public/starter-audio/', import.meta.url);

it('ships a non-silent, digest-verified Marin clip for every starter word and no extra words', async () => {
  expect(manifest.profile).toEqual(speechProfile({ NODE_ENV: 'test' }));
  const instructions = JSON.parse(await readFile(new URL('../../../../../prompts/server/speech.json', import.meta.url), 'utf8'));
  expect(manifest.instructionsDigest).toBe(createHash('sha256').update(JSON.stringify(instructions)).digest('hex'));
  expect(manifest.clips.map(clip => [clip.text, clip.language])).toEqual(tiles.map(tile => [tile.speech, tile.language]));
  expect((await readdir(assets)).sort()).toEqual(manifest.clips.map(clip => `${clip.id}.wav`).sort());
  let total = 0;
  for (const tile of tiles) {
    const asset = starterAudioAsset(tile)!;
    const clip = manifest.clips.find(clip => clip.id === asset.id)!;
    expect(asset.uri).toBe(`/starter-audio/${asset.id}.wav`);
    const bytes = await readFile(new URL(`${asset.id}.wav`, assets));
    total += bytes.length;
    expect(bytes.length).toBe(clip.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.id);
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

it('does not reuse a recording when words or language change', () => {
  expect(starterAudioAsset({ ...tiles[0], speech: 'Different words' })).toBeUndefined();
  expect(starterAudioAsset({ ...tiles[0], language: 'fr-FR' })).toBeUndefined();
});
