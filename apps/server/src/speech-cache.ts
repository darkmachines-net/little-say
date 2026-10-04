import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { speechAssetIdSchema, speechInputSchema, type SpeechInput } from '@little-say/core';
import { MAX_SPEECH_BYTES, type SpeechProfile } from './synthesis';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export class SpeechCacheError extends Error { constructor(message: string, readonly statusCode: number) { super(message); } }
export class SpeechCache {
  private pending = new Map<string, Promise<{ id: string; cacheHit: boolean }>>();
  private active = 0;
  constructor(private directory: string, private profile: SpeechProfile, private synthesize: ((input: SpeechInput) => Promise<Buffer>) | null, private maxConcurrent = 2) {}

  async read(id: string): Promise<Buffer | null> {
    if (!speechAssetIdSchema.safeParse(id).success) return null;
    try {
      const audio = await readFile(join(this.directory, `${id}.wav`));
      return audio.length <= MAX_SPEECH_BYTES && hash(audio) === id ? audio : null;
    }
    catch (error) { if (missing(error)) return null; throw error; }
  }

  get(raw: SpeechInput, regenerate = false) {
    const input = speechInputSchema.parse(raw);
    const key = hash(JSON.stringify({ ...input, ...this.profile }));
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = this.produce(key, input, regenerate).finally(() => { this.pending.delete(key); });
    this.pending.set(key, task);
    return task;
  }

  private async atomicWrite(path: string, data: Buffer | string) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, data); await rename(temporary, path); }
    finally { await unlink(temporary).catch(error => { if (!missing(error)) throw error; }); }
  }

  private async produce(key: string, input: SpeechInput, regenerate: boolean) {
    const pointer = join(this.directory, `${key}.json`);
    if (!regenerate) {
      try {
        const id = speechAssetIdSchema.parse(JSON.parse(await readFile(pointer, 'utf8')).id);
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
      await mkdir(this.directory, { recursive: true });
      await this.atomicWrite(join(this.directory, `${id}.wav`), audio);
      // Replace the lookup only after the fresh audio is durable. Existing URLs
      // remain immutable, including when regeneration fails or another device plays.
      await this.atomicWrite(pointer, JSON.stringify({ id }));
      return { id, cacheHit: false };
    } finally { this.active--; }
  }
}
