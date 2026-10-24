/** @file Persists idempotent picture jobs and immutable PNG assets with bounded, cancellable generation. */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pictureJobSchema, pictureJobRequestSchema, pictureAssetIdSchema, resolvedPictureSchema, type PictureJob, type PictureJobRequest, type CatalogEntry, type ResolvedPicture } from '@little-say/core';
import { searchPictures, catalogPicture, downloadCatalogPicture, normalizePicture } from './catalog';
import { type PictureProvider, type PictureCandidate } from './provider';

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type StoredJob = { fingerprint: string; job: PictureJob };

/** Release one cancelled subscriber without aborting catalog loads shared by other jobs. */
function waitForShared<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new Error('Cancelled'));
    const clean = () => signal.removeEventListener('abort', cancel);
    signal.addEventListener('abort', cancel, { once: true });
    work.then(value => { clean(); resolve(value); }, error => { clean(); reject(error); });
    if (signal.aborted) { clean(); cancel(); }
  });
}

export class PictureJobError extends Error {
  /** Preserve a safe message and HTTP status without exposing provider response bodies. */
  constructor(message: string, readonly statusCode: number) { super(message); }
}

export class PictureJobs {
  private jobs = new Map<string, StoredJob>();
  private pending = new Map<string, Promise<PictureJob>>();
  private queue: { input: PictureJobRequest; stored: StoredJob }[] = [];
  private active = new Map<string, AbortController>();
  private sourceLoads = new Map<string, Promise<{ entry: CatalogEntry; bytes: Buffer; picture: ResolvedPicture }>>();
  private ready: Promise<void>;
  private closed = false;
  /** Open a dedicated durable cache; unfinished jobs become interrupted rather than repeating paid requests. */
  constructor(private directory: string, readonly provider?: PictureProvider, readonly generationEnabled = false, private concurrency = 2) { this.ready = this.restore(); }

  private async restore() {
    await mkdir(this.directory, { recursive: true });
    for (const name of await readdir(this.directory)) {
      if (!/^job-[0-9a-f-]+\.json$/.test(name)) continue;
      try {
        const stored = JSON.parse(await readFile(join(this.directory, name), 'utf8')) as StoredJob;
        stored.job = pictureJobSchema.parse(stored.job);
        if (stored.job.state === 'working' || stored.job.state === 'queued') {
          stored.job = { ...stored.job, state: 'error', error: 'Picture work was interrupted. Retry explicitly to continue.' };
          await this.persist(stored);
        }
        this.jobs.set(stored.job.id, stored);
      } catch { /* A damaged job record cannot affect existing saved pictures. */ }
    }
  }
  private async atomic(name: string, value: Buffer | string) {
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    await writeFile(temporary, value); await rename(temporary, join(this.directory, name));
  }
  private persist(stored: StoredJob) { return this.atomic(`job-${stored.job.id}.json`, JSON.stringify(stored)); }

  /** Return a valid immutable PNG, or null for a missing/corrupt/invalid asset ID. */
  async read(id: string): Promise<Buffer | null> {
    await this.ready;
    if (!pictureAssetIdSchema.safeParse(id).success) return null;
    try { const bytes = await readFile(join(this.directory, `${id}.png`)); return hash(bytes) === id && bytes.length <= 8 * 1024 * 1024 ? bytes : null; }
    catch (error) { if (missing(error)) return null; throw error; }
  }
  private async put(bytes: Buffer) { const id = hash(bytes); await this.atomic(`${id}.png`, bytes); return id; }

  /** Download/cache a catalog-owned source without invoking AI, suitable for manual picture selection. */
  async library(id: string): Promise<{ entry: CatalogEntry; bytes: Buffer; picture: ResolvedPicture }> {
    await this.ready;
    const existing = this.sourceLoads.get(id); if (existing) return existing;
    const task = this.loadSource(id).finally(() => this.sourceLoads.delete(id));
    this.sourceLoads.set(id, task); return task;
  }
  private async loadSource(id: string) {
    const entry = catalogPicture(id); if (!entry) throw new PictureJobError('Unknown library picture.', 404);
    const name = `source-${hash(JSON.stringify(entry.provenance))}.json`;
    try {
      const picture = resolvedPictureSchema.parse(JSON.parse(await readFile(join(this.directory, name), 'utf8')));
      const bytes = picture.kind !== 'unresolved' ? await this.read(picture.assetId) : null;
      if (bytes) return { entry, bytes, picture };
    } catch (error) { if (!missing(error) && !(error instanceof SyntaxError) && (error as Error).name !== 'ZodError') throw error; }
    const bytes = await downloadCatalogPicture(entry);
    const picture: ResolvedPicture = { kind: 'library', assetId: await this.put(bytes), style: entry.style, provenance: entry.provenance };
    await this.atomic(name, JSON.stringify(picture)); return { entry, bytes, picture };
  }

  /** Create one durable job per request ID; a different payload with that ID is rejected. */
  async start(raw: PictureJobRequest): Promise<PictureJob> {
    await this.ready;
    const input = pictureJobRequestSchema.parse(raw);
    const waiting = this.pending.get(input.requestId);
    if (waiting) { await waiting; return this.start(input); }
    const task = this.enqueue(input); this.pending.set(input.requestId, task);
    try { return await task; } finally { this.pending.delete(input.requestId); }
  }
  private async enqueue(input: PictureJobRequest) {
    const fingerprint = hash(JSON.stringify(input));
    const previous = this.jobs.get(input.requestId);
    if (previous) {
      if (previous.job.state === 'cancelled' && previous.fingerprint === '') return previous.job;
      if (previous.fingerprint !== fingerprint) throw new PictureJobError('That picture request has already been used for different content.', 409);
      return previous.job;
    }
    if (this.closed || this.queue.length >= 48) throw new PictureJobError('The picture service is busy. Try again shortly.', 429);
    const stored: StoredJob = { fingerprint, job: { id: input.requestId, draftId: input.draftId, tileId: input.tileId, state: 'queued' } };
    await this.persist(stored); this.jobs.set(input.requestId, stored); this.queue.push({ input, stored }); this.pump(); return stored.job;
  }

  /** Read job status without restarting or retrying work. */
  async status(id: string): Promise<PictureJob | null> { await this.ready; return uuid.test(id) ? this.jobs.get(id)?.job ?? null : null; }
  /** Cancel queued work and abort active generation; an already completed request remains readable. */
  async cancel(id: string): Promise<PictureJob | null> {
    await this.ready;
    if (!uuid.test(id)) return null;
    // Cancellation may arrive before the POST response or its durable write.
    const starting = this.pending.get(id); if (starting) await starting.catch(() => {});
    let stored = this.jobs.get(id);
    if (!stored) {
      stored = { fingerprint: '', job: { id, draftId: '', tileId: '', state: 'cancelled' } };
      this.jobs.set(id, stored); await this.persist(stored); return stored.job;
    }
    if (stored.job.state === 'queued' || stored.job.state === 'working') {
      this.queue = this.queue.filter(item => item.stored !== stored);
      stored.job = { ...stored.job, state: 'cancelled' }; this.active.get(id)?.abort(); await this.persist(stored);
    }
    return stored.job;
  }
  /** Stop accepting work and abort active requests when the server closes. */
  close(): void { this.closed = true; for (const controller of this.active.values()) controller.abort(); }

  private pump() {
    while (!this.closed && this.active.size < this.concurrency && this.queue.length) {
      const item = this.queue.shift()!; const controller = new AbortController(); this.active.set(item.input.requestId, controller);
      void this.run(item.input, item.stored, controller.signal).finally(() => { this.active.delete(item.input.requestId); this.pump(); });
    }
  }
  private async run(input: PictureJobRequest, stored: StoredJob, signal: AbortSignal) {
    try {
      stored.job = { ...stored.job, state: 'working' }; await this.persist(stored);
      const result = await this.resolve(input, signal, async phase => {
        if (signal.aborted) return;
        stored.job = { ...stored.job, phase }; await this.persist(stored);
      });
      if (signal.aborted) return;
      stored.job = { ...stored.job, state: 'complete', result }; await this.persist(stored);
    } catch {
      if (signal.aborted) return;
      stored.job = { ...stored.job, state: 'error', error: 'Picture work could not finish. Your saved picture is unchanged. Retry when ready.' };
      await this.persist(stored).catch(() => {});
    }
  }
  private async resolve(input: PictureJobRequest, signal: AbortSignal, progress: (phase: 'finding' | 'generating') => Promise<void>): Promise<ResolvedPicture> {
    const unresolved = (reason: string): ResolvedPicture => ({ kind: 'unresolved', reason });
    if (!this.provider) return unresolved('Automatic matching needs AI. Search the library or choose an emoji or photo.');
    const key = hash(JSON.stringify({ concept: input.concept, style: input.style, mode: input.mode, neighbors: input.neighbors, model: this.provider.model, version: 1 }));
    if (!input.regenerate) {
      try {
        const result = resolvedPictureSchema.parse(JSON.parse(await readFile(join(this.directory, `match-${key}.json`), 'utf8')));
        if (result.kind !== 'unresolved' && (result.kind !== 'generated' || input.allowGeneration) && await this.read(result.assetId)) return result;
      } catch (error) { if (!missing(error) && !(error instanceof SyntaxError) && (error as Error).name !== 'ZodError') throw error; }
    }
    if (input.mode !== 'generated' && !input.regenerate) {
      await progress('finding');
      if (signal.aborted) throw new Error('Cancelled');
      const entries = [...new Map(input.concept.searchTerms.flatMap(term => searchPictures(term, input.style, 4)).map(entry => [entry.id, entry])).values()].slice(0, 6);
      const loaded = await waitForShared(Promise.allSettled(entries.map(entry => this.library(entry.id))), signal);
      if (signal.aborted) throw new Error('Cancelled');
      const sources = loaded.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      const selected = await this.provider.select(input.concept, sources.map(source => ({ id: source.entry.id, name: source.entry.name, bytes: source.bytes })), input.neighbors, signal);
      if (signal.aborted) throw new Error('Cancelled');
      const picture = sources.find(source => source.entry.id === selected)?.picture;
      if (picture) { await this.atomic(`match-${key}.json`, JSON.stringify(picture)); return picture; }
    }
    if (signal.aborted) throw new Error('Cancelled');
    if (input.mode === 'library' || !input.allowGeneration || !this.generationEnabled) return unresolved('No clear library match. Choose another picture or enable AI pictures.');
    await progress('generating');
    if (signal.aborted) throw new Error('Cancelled');
    const bytes = await normalizePicture(await this.provider.generate(input.concept, input.style, signal));
    if (signal.aborted) throw new Error('Cancelled');
    const chosen = await this.provider.select(input.concept, [{ id: 'generated', name: input.concept.description, bytes }], input.neighbors, signal);
    if (signal.aborted) throw new Error('Cancelled');
    if (!chosen) return unresolved('The generated picture did not clearly represent this card. Try a more specific description.');
    const picture: ResolvedPicture = { kind: 'generated', assetId: await this.put(bytes), description: input.concept.description, style: input.style, model: this.provider.model };
    await this.atomic(`match-${key}.json`, JSON.stringify(picture)); return picture;
  }

  /** Inspect stored image pixels as a board, including deterministic duplicate detection for distinct meanings. */
  async review(cards: { id: string; assetId: string; concept: PictureJobRequest['concept'] }[]): Promise<string[]> {
    if (!this.provider) throw new PictureJobError('Picture review needs AI configured on the server.', 503);
    const candidates: (PictureCandidate & { concept: PictureJobRequest['concept'] })[] = [];
    const rejected = new Set<string>();
    for (const card of cards) {
      const bytes = await this.read(card.assetId);
      if (!bytes) { rejected.add(card.id); continue; }
      if (cards.some(other => other.id !== card.id && other.assetId === card.assetId && other.concept.description.toLowerCase() !== card.concept.description.toLowerCase())) rejected.add(card.id);
      candidates.push({ id: card.id, name: card.concept.description, concept: card.concept, bytes });
    }
    for (const id of await this.provider.review(candidates)) rejected.add(id);
    return [...rejected];
  }
}
