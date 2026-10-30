/**
 * @file Caches speech through injected media/metadata storage with immutable clips and bounded synthesis.
 */

import { createHash } from 'node:crypto';
import { cacheStore, type CacheStore } from './hosting/storage';
import { speechAssetIdSchema, speechInputSchema, type SpeechInput } from '@little-say/core';
import { MAX_SPEECH_BYTES, type SpeechProfile } from './synthesis';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export class SpeechCacheError extends Error {
  /** Associate a cache failure with the HTTP status the API should return. */
  constructor(message: string, readonly statusCode: number) { super(message); }
}
export class SpeechCache {
  private pending = new Map<string, Promise<{ id: string; cacheHit: boolean }>>();
  private active = 0;
  private storage: CacheStore;
  /**
   * Configure persistent storage, synthesis identity, and concurrency; a null synthesizer permits cache
   * reads without new generation.
   */
  constructor(directory: string | CacheStore, private profile: SpeechProfile, private synthesize: ((input: SpeechInput) => Promise<Buffer>) | null, private maxConcurrent = 2) { this.storage = cacheStore(directory); }

  /**
   * Read a digest-addressed WAV, returning null for invalid IDs, absent files, or failed content checks
   * while propagating filesystem errors.
   */
  async read(id: string): Promise<Buffer | null> {
    if (!speechAssetIdSchema.safeParse(id).success) return null;
    try {
      const audio = await this.storage.read(`${id}.wav`);
      return audio.length <= MAX_SPEECH_BYTES && hash(audio) === id ? audio : null;
    }
    catch (error) { if (missing(error)) return null; throw error; }
  }

  /**
   * Resolve validated speech input from cache or synthesis, sharing same-key work. Regeneration skips
   * stored pointers; disabled or saturated synthesis raises a status-bearing error.
   */
  get(raw: SpeechInput, regenerate = false) {
    const input = speechInputSchema.parse(raw);
    const key = hash(JSON.stringify({ ...input, ...this.profile }));
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = this.produce(key, input, regenerate).finally(() => { this.pending.delete(key); });
    this.pending.set(key, task);
    return task;
  }

  /** Look up verified clips without starting synthesis, including when generation is saturated or disabled. */
  async lookup(inputs: SpeechInput[]): Promise<(SpeechInput & { id: string })[]> {
    const normalized = [...new Map(inputs.map(raw => { const input = speechInputSchema.parse(raw); return [JSON.stringify(input), input]; })).values()];
    const results = await Promise.all(normalized.map(async input => {
      const key = hash(JSON.stringify({ ...input, ...this.profile }));
      try {
        const id = speechAssetIdSchema.parse(JSON.parse((await this.storage.read(`${key}.json`)).toString()).id);
        return await this.read(id) ? { ...input, id } : null;
      } catch (error) { if (missing(error) || error instanceof SyntaxError || (error as Error).name === 'ZodError') return null; throw error; }
    }));
    return results.filter(result => result !== null);
  }

  private async atomicWrite(path: string, data: Buffer | string) {
    await this.storage.write(path, data);
  }

  private async produce(key: string, input: SpeechInput, regenerate: boolean) {
    const pointer = `${key}.json`;
    if (!regenerate) {
      try {
        const id = speechAssetIdSchema.parse(JSON.parse((await this.storage.read(pointer)).toString()).id);
        if (await this.read(id)) return { id, cacheHit: true };
      } catch (error) { if (!missing(error) && !(error instanceof SyntaxError) && (error as Error).name !== 'ZodError') throw error; }
    }
    if (!this.synthesize) throw new SpeechCacheError('AI speech needs a server API key. Device speech is still available.', 503);
    if (this.active >= this.maxConcurrent) throw new SpeechCacheError('Speech generation is busy. Please try again shortly.', 429);
    this.active++;
    try {
      const audio = await this.synthesize(input);
      if (audio.length < 46 || audio.length > MAX_SPEECH_BYTES || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid generated audio.');
      const id = hash(audio);
      await this.atomicWrite(`${id}.wav`, audio);
      // Replace the lookup only after the fresh audio is durable. Existing URLs
      // remain immutable, including when regeneration fails or another device plays.
      await this.atomicWrite(pointer, JSON.stringify({ id }));
      return { id, cacheHit: false };
    } finally { this.active--; }
  }
}
