/** @file Verifies anonymous starter audio is a fixed, cache-only allowlist with no arbitrary speech disclosure or synthesis. */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/app';
import { SpeechCache } from '../src/speech-cache';
import { pcmToWav, speechProfile } from '../src/synthesis';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'little-say-starter-audio-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it.each([false, true])('serves only prepared English starter words without generating (synthesis disabled=%s)', async disabled => {
  const generate = vi.fn(async () => pcmToWav(Buffer.alloc(100, generate.mock.calls.length)));
  const profile = speechProfile({});
  const writer = new SpeechCache(directory, profile, generate);
  const horse = await writer.get({ text: 'Horse', language: 'en-US' });
  const privateClip = await writer.get({ text: 'Private family phrase', language: 'en-US' });
  const otherLanguage = await writer.get({ text: 'Horse', language: 'fr-FR' });
  generate.mockClear();
  const app = await createServer({ provider: null, speechCache: disabled ? new SpeechCache(directory, profile, null) : writer });
  try {
    const index = await app.inject('/api/starter-boards/audio?text=Private%20family%20phrase');
    expect(index.statusCode).toBe(200);
    expect(index.json()).toEqual({ clips: [{ text: 'Horse', language: 'en-US', id: horse.id }] });
    const clip = await app.inject(`/api/starter-boards/audio/${horse.id}.wav`);
    expect(clip.statusCode).toBe(200); expect(clip.rawPayload).toEqual(await writer.read(horse.id));
    expect(clip.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    for (const id of [privateClip.id, otherLanguage.id, 'a'.repeat(64), 'invalid']) {
      expect((await app.inject(`/api/starter-boards/audio/${id}.wav`)).statusCode).toBe(404);
    }
    expect(generate).not.toHaveBeenCalled();
  } finally { await app.close(); }
});

it('returns an empty index when cached clips are unavailable or from another synthesis profile', async () => {
  const profile = speechProfile({});
  await new SpeechCache(directory, profile, async () => pcmToWav(Buffer.alloc(100))).get({ text: 'Horse', language: 'en-US' });
  for (const speechCache of [undefined, new SpeechCache(directory, { ...profile, voice: 'other' }, null)]) {
    const app = await createServer({ provider: null, speechCache });
    try { expect((await app.inject('/api/starter-boards/audio')).json()).toEqual({ clips: [] }); }
    finally { await app.close(); }
  }
});
