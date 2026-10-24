/** @file Prepares drafts with immediate reusable pictures and durable cancellable batches, isolating shared generic content from request data. */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pictureBatchSchema, proposalSchema, validateGeneratedBoard, defaultPicturePolicy, type BoardProposal, type GeneratedBoard, type PictureBatch, type PictureConcept, type ProposalRequest, type ResolvedPicture } from '@little-say/core';
import { type AiProvider } from './provider';
import { draftFailure, draftRequestId, type DraftFailure } from './draft-diagnostics';
import { PictureJobs } from './pictures/jobs';
import { searchPictures } from './pictures/catalog';
import { GenericContent } from './generic-content';
import { genericConcept, canonicalPictureConcept } from './generic-concepts';
import { PictureScheduler } from './picture-scheduler';
import { type SpeechCache } from './speech-cache';

type Record = { fingerprint: string; batch: PictureBatch; envelope?: BoardProposal };
type PendingTile = { index: number; concept: PictureConcept; mode: 'auto' | 'library' | 'generated'; style: 'color' | 'line'; instruction: string; regenerate: boolean };
export type PreparationMetric = { operation: string; milliseconds?: number; count?: number; cacheHit?: boolean; requestId?: string; stage?: string; failure?: DraftFailure };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Owns standard negotiated board preparation; manual and older-client picture jobs remain independently usable. */
export class BoardPreparation {
  private records = new Map<string, Record>();
  private pending = new Map<string, Promise<BoardProposal>>();
  private active = new Map<string, AbortController>();
  private writes = new Map<string, Promise<void>>();
  private ready: Promise<void>;
  private scheduler: PictureScheduler;
  private closed = false;
  /** Open request records separately from the generic index; unfinished batches never replay paid work. */
  constructor(private directory: string, private provider: AiProvider, private pictures: PictureJobs, readonly content: GenericContent, private speech?: SpeechCache, concurrency = 6, private metric?: (event: PreparationMetric) => void) {
    this.scheduler = new PictureScheduler(concurrency); this.ready = this.restore();
  }
  private async restore() {
    await mkdir(this.directory, { recursive: true });
    for (const name of await readdir(this.directory)) {
      if (!/^batch-[0-9a-f-]+\.json$/.test(name)) continue;
      try {
        const value = JSON.parse(await readFile(join(this.directory, name), 'utf8')) as Record;
        value.batch = pictureBatchSchema.parse(value.batch);
        if (name !== `batch-${value.batch.id}.json` || typeof value.fingerprint !== 'string') continue;
        if (value.envelope) value.envelope = proposalSchema.parse(value.envelope);
        if (value.batch.state === 'working') { value.batch.state = 'error'; for (const tile of value.batch.tiles) if (tile.state !== 'ready') tile.state = 'fallback'; }
        this.records.set(value.batch.id, value);
      } catch { /* Invalid records cannot cause a new provider request. */ }
    }
  }
  private persist(record: Record) {
    const id = record.batch.id;
    const data = JSON.stringify(record);
    const previous = this.writes.get(id) ?? Promise.resolve();
    const work = previous.catch(() => {}).then(async () => {
      const temporary = join(this.directory, `${randomUUID()}.tmp`);
      await writeFile(temporary, data); await rename(temporary, join(this.directory, `batch-${id}.json`));
    });
    this.writes.set(id, work);
    void work.finally(() => { if (this.writes.get(id) === work) this.writes.delete(id); }).catch(() => {});
    return work;
  }
  /** Start once for a caller-generated request ID; the ID also permits cancellation before the response arrives. */
  async propose(request: ProposalRequest): Promise<BoardProposal> {
    await this.ready;
    if (!request.preparationId || this.closed) throw new Error('Preparation unavailable.');
    const id = request.preparationId;
    const running = this.pending.get(id);
    if (running) { await running; return this.propose(request); }
    const previous = this.records.get(id);
    if (previous) {
      if (previous.fingerprint !== hash(request) || !previous.envelope || previous.batch.state === 'cancelled') throw new Error('Preparation request is already used or cancelled.');
      return structuredClone({ ...previous.envelope, preparation: previous.batch });
    }
    const work = this.start(request);
    this.pending.set(id, work);
    try { return await work; } finally { this.pending.delete(id); }
  }
  private async start(request: ProposalRequest): Promise<BoardProposal> {
    const id = request.preparationId!;
    const controller = new AbortController(); this.active.set(id, controller);
    const record: Record = { fingerprint: hash(request), batch: { id, state: 'working', tiles: [] } };
    this.records.set(id, record);
    const started = Date.now(); let stage = 'persist';
    try {
      await this.persist(record);
      controller.signal.throwIfAborted();
      const start = Date.now();
      stage = 'lookup';
      const template = await this.content.exact(request);
      controller.signal.throwIfAborted();
      const related = template ? [] : await this.content.related(request);
      stage = 'draft';
      const generated = template?.board ?? await this.provider.prepare!(request, related, controller.signal);
      stage = 'validate';
      const proposal = validateGeneratedBoard(generated, request.board);
      controller.signal.throwIfAborted();
      const draftMs = Date.now() - start;
      this.metric?.({ operation: 'draft', milliseconds: draftMs, cacheHit: Boolean(template), requestId: draftRequestId(id) });
      const envelope: BoardProposal = { boardId: request.board?.id ?? null, baseRevision: request.board?.revision ?? null, proposal, pictures: [] };
      record.envelope = envelope;
      if (proposal.needsClarification) { record.batch.state = 'complete'; await this.persist(record); this.active.delete(id); return { ...envelope, preparation: structuredClone(record.batch) }; }
      if (proposal.tiles.some(tile => !tile.pictureConcept)) throw new Error('Missing picture concepts.');
      stage = 'pictures';
      const pending: PendingTile[] = [];
      const prior = request.previousPreparationId && request.conversation?.draft ? this.records.get(request.previousPreparationId) : undefined;
      const sameSource = prior?.envelope?.boardId === (request.board?.id ?? null) && prior?.envelope?.baseRevision === (request.board?.revision ?? null);
      const signature = (tile: GeneratedBoard['tiles'][number]) => hash({ existingId: tile.existingId, concept: tile.pictureConcept, emoji: tile.emoji, options: tile.pictureOptions });
      const resolveStart = Date.now();
      await Promise.all(proposal.tiles.map(async (tile, index) => {
        const concept = tile.pictureConcept!;
        const mode = tile.pictureOptions?.mode ?? proposal.picturePolicy?.mode ?? defaultPicturePolicy.mode;
        const style = tile.pictureOptions?.style ?? proposal.picturePolicy?.style ?? defaultPicturePolicy.style;
        const regenerate = Boolean(tile.replacePicture && mode === 'generated');
        const state: PictureBatch['tiles'][number] = { index, state: 'ready' };
        record.batch.tiles.push(state);
        if (tile.existingId && !tile.replacePicture) return;
        if (mode === 'emoji') return;
        if (sameSource && prior?.envelope && !tile.replacePicture && JSON.stringify(proposal.picturePolicy) === JSON.stringify(prior.envelope.proposal.picturePolicy)) {
          const previous = prior.envelope.proposal.tiles.findIndex(value => signature(value) === signature(tile));
          const retained = prior.batch.tiles.find(value => value.index === previous && value.state === 'ready')?.result;
          if (retained && retained.kind !== 'unresolved' && (mode !== 'library' || retained.kind === 'library') && (mode !== 'generated' || retained.kind === 'generated') && await this.pictures.read(retained.assetId)) { state.result = retained; return; }
        }
        const instruction = tile.pictureOptions?.instruction ?? '';
        const known = genericConcept(concept, instruction);
        const cached = known && !regenerate && (template?.pictures.find(value => value.index === index)?.picture ?? await this.content.picture(known, style));
        if (cached && cached.kind !== 'unresolved' && cached.style === style && (mode !== 'library' || cached.kind === 'library') && (mode !== 'generated' || cached.kind === 'generated') && await this.pictures.read(cached.assetId)) {
          state.result = cached; this.metric?.({ operation: 'picture-cache-hit', count: 1 }); return;
        }
        if (known?.source && mode !== 'generated' && style === 'color') {
          // Bundled assets never wait on an external catalog download in the proposal path.
          const seeded = await this.pictures.seed(known.source);
          if (seeded) { state.result = seeded; await this.content.rememberPicture(known, seeded); this.metric?.({ operation: 'seed-hit', count: 1 }); return; }
        }
        if (known && mode !== 'library' && !regenerate) {
          const seeded = await this.pictures.generatedSeed(known.id, style);
          if (seeded) { state.result = seeded; await this.content.rememberPicture(known, seeded); this.metric?.({ operation: 'seed-hit', count: 1 }); return; }
        }
        const emojiAccurate = concept.emojiAccurate && !instruction && !proposal.tiles.some(other => other !== tile && other.emoji === tile.emoji && other.pictureConcept?.description !== concept.description);
        if (mode === 'auto' && emojiAccurate) return;
        const requiredConcept = instruction ? { ...concept, features: [...concept.features, `Picture requirement: ${instruction}`] } : concept;
        state.state = 'queued'; pending.push({ index, concept: requiredConcept, mode, style, instruction, regenerate });
      }));
      controller.signal.throwIfAborted();
      this.rejectDuplicates(record, proposal);
      for (const state of record.batch.tiles.filter(tile => tile.state === 'fallback')) {
        const tile = proposal.tiles[state.index];
        const mode = tile.pictureOptions?.mode ?? proposal.picturePolicy?.mode ?? 'auto';
        if (mode !== 'emoji' && (!tile.existingId || tile.replacePicture)) {
          state.state = 'queued'; pending.push({ index: state.index, concept: tile.pictureConcept!, mode, style: tile.pictureOptions?.style ?? proposal.picturePolicy?.style ?? defaultPicturePolicy.style, instruction: tile.pictureOptions?.instruction ?? '', regenerate: Boolean(tile.replacePicture && mode === 'generated') });
        }
      }
      record.batch.tiles.sort((a, b) => a.index - b.index);
      envelope.pictures = record.batch.tiles.flatMap(tile => tile.result && tile.result.kind !== 'unresolved' ? [{ index: tile.index, illustration: tile.result, concept: proposal.tiles[tile.index].pictureConcept }] : []);
      stage = 'speech';
      envelope.speech = await this.speech?.lookup(proposal.tiles.flatMap(tile => [{ text: tile.speech, language: tile.language }, ...(tile.translations ?? []).map(value => ({ text: value.speech, language: value.language }))])).catch(() => []);
      envelope.timing = { draftMs, resolveMs: Date.now() - resolveStart, templateHit: Boolean(template) };
      if (!pending.length) record.batch.state = 'complete';
      stage = 'persist';
      await this.persist(record);
      const response = structuredClone({ ...envelope, preparation: record.batch });
      if (pending.length) void this.finish(record, request, pending, controller).finally(() => this.active.delete(id));
      else { this.active.delete(id); await this.remember(record, request); }
      return response;
    } catch (error) {
      this.metric?.({ operation: 'preparation-failed', milliseconds: Date.now() - started, requestId: draftRequestId(id), stage, failure: draftFailure(error, controller.signal.aborted) });
      if (record.batch.state !== 'cancelled') record.batch.state = 'error';
      await this.persist(record).catch(() => {}); this.active.delete(id); throw error;
    }
  }
  private rejectDuplicates(record: Record, proposal: GeneratedBoard) {
    const rejected = new Set<number>();
    const meaning = (index: number) => {
      const tile = proposal.tiles[index]; const concept = tile.pictureConcept!;
      return genericConcept(concept, tile.pictureOptions?.instruction)?.id ?? hash({ description: concept.description.toLowerCase(), features: [...concept.features].sort(), instruction: tile.pictureOptions?.instruction ?? '' });
    };
    for (const tile of record.batch.tiles) {
      const picture = tile.result;
      if (!picture || picture.kind === 'unresolved') continue;
      if (record.batch.tiles.some(other => other.index !== tile.index && other.result && other.result.kind !== 'unresolved' && other.result.assetId === picture.assetId && meaning(other.index) !== meaning(tile.index))) rejected.add(tile.index);
    }
    for (const tile of record.batch.tiles) if (rejected.has(tile.index)) { tile.state = 'fallback'; tile.result = undefined; }
  }
  private async remember(record: Record, request: ProposalRequest) {
    if (record.envelope && record.batch.state === 'complete' && record.batch.tiles.every(tile => tile.state === 'ready')) await this.content.remember(request, record.envelope.proposal).catch(() => {});
  }
  private async finish(record: Record, request: ProposalRequest, pending: PendingTile[], controller: AbortController) {
    const signal = controller.signal;
    const provider = this.pictures.provider;
    const neighbors = record.envelope!.proposal.tiles.map(tile => tile.pictureConcept!.description);
    try {
      if (!provider) throw new Error('Picture provider unavailable.');
      const finding = pending.filter(tile => tile.mode !== 'generated');
      for (const tile of finding) record.batch.tiles.find(value => value.index === tile.index)!.state = 'finding';
      await this.persist(record);
      const sources = await Promise.all(finding.map(async tile => {
        const entries = [...new Map(tile.concept.searchTerms.flatMap(term => searchPictures(term, tile.style, 3)).map(entry => [entry.id, entry])).values()].slice(0, 3);
        const loaded = await Promise.allSettled(entries.map(entry => this.pictures.library(entry.id)));
        return { tile, loaded: loaded.flatMap(value => value.status === 'fulfilled' ? [value.value] : []) };
      }));
      signal.throwIfAborted();
      const candidates = sources.filter(source => source.loaded.length).map(source => ({ id: String(source.tile.index), concept: source.tile.concept, candidates: source.loaded.map(value => ({ id: value.entry.id, name: value.entry.name, bytes: value.bytes })) }));
      const selected = provider.selectBatch ? await provider.selectBatch(candidates, neighbors, signal) : await Promise.all(candidates.map(async card => ({ id: card.id, candidate: await provider.select(card.concept, card.candidates, neighbors, signal) })));
      signal.throwIfAborted();
      for (const source of sources) {
        const choice = selected.find(value => value.id === String(source.tile.index))?.candidate;
        const picture = source.loaded.find(value => value.entry.id === choice)?.picture;
        if (picture) {
          const state = record.batch.tiles.find(value => value.index === source.tile.index)!;
          state.result = picture; state.state = 'ready';
          const known = genericConcept(source.tile.concept, source.tile.instruction);
          if (known) await this.content.rememberPicture(known, picture);
        }
      }
      await this.persist(record);
      await Promise.all(pending.map(async tile => {
        const state = record.batch.tiles.find(value => value.index === tile.index)!;
        if (state.state === 'ready') return;
        if (tile.mode === 'library' || !this.pictures.generationEnabled) { state.state = 'fallback'; return; }
        try {
          const known = genericConcept(tile.concept, tile.instruction);
          const concept = known ? canonicalPictureConcept(known) : tile.concept;
          const key = known && !tile.regenerate ? `generic:${known.id}:${tile.style}` : `${record.batch.id}:${tile.index}`;
          state.result = await this.scheduler.subscribe(key, record.batch.id, signal, async sharedSignal => {
            sharedSignal.throwIfAborted();
            this.metric?.({ operation: 'generate', count: 1 });
            const bytes = await provider.generate(concept, tile.style, sharedSignal);
            sharedSignal.throwIfAborted();
            const candidate = { id: 'generated', name: concept.description, bytes };
            const valid = provider.validate ? await provider.validate(concept, candidate, known ? [] : neighbors, sharedSignal) : await provider.select(concept, [candidate], known ? [] : neighbors, sharedSignal) === 'generated';
            sharedSignal.throwIfAborted();
            if (!valid) throw new Error('Picture did not match.');
            const picture: ResolvedPicture = { kind: 'generated', assetId: await this.pictures.store(bytes), description: concept.description, style: tile.style, model: provider.model };
            sharedSignal.throwIfAborted();
            if (known) await this.content.rememberPicture(known, picture);
            return picture;
          }, () => { if (!signal.aborted) { state.state = 'generating'; void this.persist(record).catch(() => {}); } });
          signal.throwIfAborted(); state.state = 'ready';
        } catch { if (!signal.aborted) state.state = 'fallback'; }
        if (!signal.aborted) await this.persist(record);
      }));
      signal.throwIfAborted();
      this.rejectDuplicates(record, record.envelope!.proposal);
      record.batch.state = 'complete'; await this.persist(record); await this.remember(record, request);
    } catch {
      if (!signal.aborted) { record.batch.state = 'error'; for (const tile of record.batch.tiles) if (tile.state !== 'ready') tile.state = 'fallback'; await this.persist(record).catch(() => {}); }
    }
  }
  /** Read aggregate status without starting new work or exposing another board's context. */
  async status(id: string): Promise<PictureBatch | null> { await this.ready; return uuid.test(id) ? structuredClone(this.records.get(id)?.batch ?? null) : null; }
  /** Cancel by known request ID, including requests whose proposal has not returned yet. */
  async cancel(id: string): Promise<PictureBatch | null> {
    await this.ready; if (!uuid.test(id)) return null;
    let record = this.records.get(id);
    if (!record) { record = { fingerprint: '', batch: { id, state: 'cancelled', tiles: [] } }; this.records.set(id, record); }
    if (record.batch.state === 'working') { record.batch.state = 'cancelled'; this.active.get(id)?.abort(); }
    await this.persist(record); return structuredClone(record.batch);
  }
  /** Stop all new and in-flight preparation, preserving restart-safe interrupted records. */
  close(): void { this.closed = true; for (const controller of this.active.values()) controller.abort(); this.scheduler.close(); }
}
