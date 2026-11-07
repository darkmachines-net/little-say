/**
 * @file Prepares transcript-checked Marin starter WAVs and their digest manifest for static web delivery.
 * --generate permits paid synthesis of missing clips; --check verifies committed assets offline.
 * Successful synthesis is cached between runs, and the manifest is published only after all clips exist.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStarterBoards } from '@little-say/core/starterBoards';
import { SpeechCache } from '../apps/server/src/speech-cache';
import { MAX_SPEECH_BYTES, openAISynthesis, speechProfile } from '../apps/server/src/synthesis';
import { loadDevelopmentEnv, withDevelopmentApiKey } from './dev-config';

type Clip = { text: string; language: string; id: string; bytes: number };
type Manifest = { profile: ReturnType<typeof speechProfile>; instructionsDigest: string; clips: Clip[] };
const root = fileURLToPath(new URL('../', import.meta.url));
const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => !['--generate', '--check'].includes(flag)) || flags.size > 1) throw new Error('Use --generate to prepare missing clips, or --check to verify without network access.');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const profile = speechProfile({}); // Product voice is pinned, independent of an operator's server overrides.
const instructionsDigest = hash(Buffer.from(JSON.stringify(JSON.parse(await readFile(resolve(root, 'prompts/server/speech.json'), 'utf8')))));
const vocabulary = createStarterBoards(() => 'bundled').flatMap(board => board.tiles.map(tile => ({ text: tile.speech, language: tile.language })));
const output = resolve(root, 'apps/mobile/public/starter-audio');
const manifestPath = resolve(root, 'apps/mobile/src/website/audio/manifest.json');
const previous = await readFile(manifestPath, 'utf8').then(value => JSON.parse(value) as Manifest).catch(error => {
  if (error.code === 'ENOENT') return undefined;
  throw error;
});
const matching = previous?.instructionsDigest === instructionsDigest && JSON.stringify(previous.profile) === JSON.stringify(profile);
const env = flags.has('--generate') ? await withDevelopmentApiKey(await loadDevelopmentEnv(root)) : {};
const cache = new SpeechCache(resolve(root, '.cache/starter-audio', instructionsDigest), profile, flags.has('--generate') ? openAISynthesis(env, profile) : null);
const clips: Clip[] = [];

function verify(bytes: Buffer, id: string) {
  if (hash(bytes) !== id || bytes.length < 4844 || bytes.length > MAX_SPEECH_BYTES
    || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 16) !== 'WAVEfmt '
    || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt32LE(24) !== 24000
    || bytes.readUInt16LE(34) !== 16 || bytes.readUInt32LE(40) !== bytes.length - 44) throw new Error(`Invalid starter WAV: ${id}`);
}

for (const input of vocabulary) {
  const stored = matching ? previous.clips.find(clip => clip.text === input.text && clip.language === input.language) : undefined;
  if (stored && /^[a-f0-9]{64}$/.test(stored.id)) {
    try {
      const bytes = await readFile(resolve(output, `${stored.id}.wav`)); verify(bytes, stored.id);
      if (stored.bytes !== bytes.length) throw new Error('Manifest size does not match the clip.');
      clips.push(stored); continue;
    } catch (error) { if (flags.has('--check')) throw error; }
  }
  if (flags.has('--check')) throw new Error(`Missing current bundled pronunciation: ${input.text} (${input.language}). Run npm run speech:starters -- --generate.`);
  const prepared = await cache.get(input);
  const bytes = await cache.read(prepared.id);
  if (!bytes) throw new Error(`Prepared clip disappeared: ${input.text}`);
  verify(bytes, prepared.id);
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, `${prepared.id}.wav`), bytes);
  clips.push({ ...input, id: prepared.id, bytes: bytes.length });
  console.log(`${input.text}: ${prepared.cacheHit ? 'reused' : 'generated'} (${bytes.length} bytes)`);
}

if (flags.has('--check')) {
  if (previous?.clips.length !== vocabulary.length) throw new Error('Bundled pronunciation list must match the starter vocabulary exactly.');
} else {
  await mkdir(dirname(manifestPath), { recursive: true });
  const temporary = `${manifestPath}.tmp`;
  await writeFile(temporary, JSON.stringify({ profile, instructionsDigest, clips }, null, 2) + '\n');
  await rename(temporary, manifestPath);
  const retained = new Set(clips.map(clip => `${clip.id}.wav`));
  for (const name of await readdir(output)) {
    if (/^[a-f0-9]{64}\.wav$/.test(name) && !retained.has(name)) await unlink(resolve(output, name));
  }
}
console.log(`Verified ${clips.length} starter clips (${clips.reduce((total, clip) => total + clip.bytes, 0)} bytes), voice ${profile.voice}.`);
