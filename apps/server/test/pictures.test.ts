/** @file Verifies picture job idempotency, costs/consent gates, cancellation, restart recovery, validation, catalog safety, provider deadlines, and selection capacity. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { PictureJobs } from '../src/picture-jobs';
import { openAIPictureProvider, type PictureProvider } from '../src/picture-provider';
import { searchPictures, normalizePicture } from '../src/picture-catalog';
import { createServer } from '../src/app';
import { type PictureJobRequest } from '@little-say/core';

const directories: string[] = [];
const services: PictureJobs[] = [];
afterEach(async () => { services.splice(0).forEach(service => service.close()); await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const input = (): PictureJobRequest => ({ requestId: randomUUID(), draftId: 'revision-1', tileId: 'mixer', concept: { description: 'concrete mixer truck', features: ['truck-mounted mixing drum'], searchTerms: ['concrete mixer truck'], emojiAccurate: false }, style: 'color', mode: 'generated', allowGeneration: true, regenerate: false, neighbors: ['dump truck'] });
async function service(overrides: Partial<PictureProvider> = {}, enabled = true, concurrency = 2) {
  const directory = await mkdtemp(join(tmpdir(), 'little-say-pictures-')); directories.push(directory);
  const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ff7700' } }).png().toBuffer();
  const provider: PictureProvider = { model: 'test-model', analyze: vi.fn(), select: vi.fn(async () => 'generated'), generate: vi.fn(async () => png), review: vi.fn(async () => []), ...overrides };
  const jobs = new PictureJobs(directory, provider, enabled, concurrency); services.push(jobs);
  // Validation-only API tests may finish before restore starts reading the cache; initialize before teardown can remove it.
  await jobs.status('none');
  return { jobs, provider, directory, png };
}
async function finished(jobs: PictureJobs, id: string) { await vi.waitFor(async () => expect(['complete', 'error', 'cancelled']).toContain((await jobs.status(id))?.state)); return (await jobs.status(id))!; }

describe('durable picture jobs', () => {
  it('uses a suitable library match without generating an illustration', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const { jobs, provider, png } = await service({ select: vi.fn(async (_concept, candidates) => { await pending; return candidates[0]?.id ?? null; }) });
    const entry = searchPictures('cow', 'color')[0];
    const picture = { kind: 'library' as const, assetId: createHash('sha256').update(png).digest('hex'), style: entry.style, provenance: entry.provenance };
    vi.spyOn(jobs, 'library').mockResolvedValue({ entry, picture, bytes: png });
    const request = { ...input(), mode: 'auto' as const, concept: { ...input().concept, description: 'cow', searchTerms: ['cow'] } };
    await jobs.start(request);
    await vi.waitFor(() => expect(provider.select).toHaveBeenCalled());
    expect(await jobs.status(request.requestId)).toMatchObject({ state: 'working', phase: 'finding' });
    release();
    expect((await finished(jobs, request.requestId)).result).toEqual(picture);
    expect(provider.generate).not.toHaveBeenCalled();
  });
  it('coalesces repeated request IDs, persists immutable assets, and rejects changed payloads', async () => {
    const { jobs, provider } = await service(); const request = input();
    await Promise.all([jobs.start(request), jobs.start(request)]);
    const job = await finished(jobs, request.requestId); expect(job.result?.kind).toBe('generated'); expect(provider.generate).toHaveBeenCalledTimes(1);
    await expect(jobs.start({ ...request, tileId: 'different' })).rejects.toThrow('different content');
    if (job.result?.kind === 'generated') expect(createHash('sha256').update((await jobs.read(job.result.assetId))!).digest('hex')).toBe(job.result.assetId);
    const next = input(); await jobs.start(next); await finished(jobs, next.requestId); expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('never generates without both client permission and server capability', async () => {
    for (const enabled of [false, true]) {
      const { jobs, provider } = await service({}, enabled); const request = { ...input(), allowGeneration: false };
      await jobs.start(request); expect((await finished(jobs, request.requestId)).result?.kind).toBe('unresolved'); expect(provider.generate).not.toHaveBeenCalled();
      if (!enabled) { const other = input(); await jobs.start(other); await finished(jobs, other.requestId); expect(provider.generate).not.toHaveBeenCalled(); }
    }
  });
  it('rejects inaccurate generated images without automatically buying a second attempt', async () => {
    const { jobs, provider } = await service({ select: vi.fn(async () => null) }); const request = input();
    await jobs.start(request); expect((await finished(jobs, request.requestId)).result?.kind).toBe('unresolved'); expect(provider.generate).toHaveBeenCalledTimes(1);
    await jobs.start(request); expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('cancels active work and does not generate cancelled queued cards', async () => {
    const generate = vi.fn((_concept, _style, signal: AbortSignal) => new Promise<Buffer>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Stopped')))));
    const { jobs } = await service({ generate }); const requests = [input(), input(), input()];
    // Start in order so the third request is queued regardless of filesystem write completion order.
    for (const request of requests) await jobs.start(request);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect((await jobs.status(requests[0].requestId))?.phase).toBe('generating');
    expect((await jobs.status(requests[2].requestId))?.state).toBe('queued');
    await jobs.cancel(requests[2].requestId); await jobs.cancel(requests[0].requestId); await jobs.cancel(requests[1].requestId);
    expect((await jobs.status(requests[2].requestId))?.state).toBe('cancelled'); expect(generate).toHaveBeenCalledTimes(2);
  });
  it('marks interrupted jobs for explicit retry on restart without a provider call', async () => {
    const { directory, provider, jobs } = await service(); await jobs.status('none');
    const id = randomUUID(); await writeFile(join(directory, `job-${id}.json`), JSON.stringify({ fingerprint: 'test', job: { id, draftId: 'draft', tileId: 'tile', state: 'working' } }));
    const restored = new PictureJobs(directory, provider, true); services.push(restored);
    expect(await restored.status(id)).toMatchObject({ state: 'error', error: expect.stringContaining('interrupted') }); expect(provider.generate).not.toHaveBeenCalled();
  });
  it('honors cancellation that arrives before the original job POST', async () => {
    const { jobs, provider } = await service(); const request = input();
    await jobs.cancel(request.requestId);
    expect((await jobs.start(request)).state).toBe('cancelled'); expect(provider.generate).not.toHaveBeenCalled();
  });
});
describe('trusted catalog and API', () => {
  it('searches the selected style and retains attribution while refusing executable SVG content', async () => {
    expect(searchPictures('dumper truck', 'color')[0]).toMatchObject({ name: 'dumper truck', provenance: { library: 'mulberry', license: 'CC-BY-SA-4.0' } });
    expect(searchPictures('truck', 'line').every(entry => entry.style === 'line')).toBe(true);
    await expect(normalizePicture(Buffer.from('<svg><image href="http://127.0.0.1/private"/></svg>'), true)).rejects.toThrow('resources');
    await expect(normalizePicture(Buffer.from('invalid'))).rejects.toThrow();
  });
  it('rejects malformed jobs before work and enforces the app request header', async () => {
    const { jobs, provider } = await service(); const app = await createServer({ provider: null, pictures: jobs });
    try {
      expect((await app.inject('/api/health')).json().pictures).toMatchObject({ version: 1, catalog: true, analysis: true, generation: true });
      expect((await app.inject({ method: 'POST', url: '/api/pictures/jobs', payload: input() })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/pictures/jobs', headers: { 'x-little-say': '1' }, payload: { ...input(), requestId: '../private' } })).statusCode).toBe(400);
      expect(provider.generate).not.toHaveBeenCalled();
      expect((await app.inject('/api/pictures/assets/not-a-digest.png')).statusCode).toBe(404);
    } finally { await app.close(); }
  });
});

describe('synchronous picture deadlines', () => {
  for (const operation of ['analyze', 'review'] as const) it(`ends slow ${operation} before the client deadline and frees capacity for retry`, async () => {
    let started!: () => void;
    const fetching = new Promise<void>(resolve => { started = resolve; });
    const concept = input().concept;
    const output = operation === 'analyze' ? { tiles: [{ id: 'card', emoji: '🚚', concept }] } : { rejected: [] };
    let calls = 0;
    let aborted = false;
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => {
      calls++;
      if (calls === 1) return new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); });
        started();
      });
      return Promise.resolve(new Response(JSON.stringify({ id: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }] }), { headers: { 'Content-Type': 'application/json' } }));
    }));
    const provider = openAIPictureProvider({ OPENAI_API_KEY: 'test-key' })!;
    const { jobs, png } = await service(provider);
    vi.spyOn(jobs, 'read').mockResolvedValue(png);
    const app = await createServer({ provider: null, pictures: jobs, maxConcurrent: 1 });
    await app.ready();
    const request = { method: 'POST' as const, url: '/api/pictures/' + operation, headers: { 'X-Little-Say': '1' }, payload: operation === 'analyze' ? { tiles: [{ id: 'card', label: 'truck', language: 'en-US', emoji: '🚚', instruction: '' }] } : { cards: [{ id: 'card', assetId: 'a'.repeat(64), concept }] } };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      let completed = false;
      const first = app.inject(request).then(response => { completed = true; return response; });
      await fetching;
      await vi.advanceTimersByTimeAsync(59000);
      const withinClientDeadline = completed;
      if (!completed) await vi.advanceTimersByTimeAsync(180000);
      const response = await first;
      expect(withinClientDeadline).toBe(true);
      expect(aborted).toBe(true);
      expect(response.statusCode).toBe(502);
      expect(response.json().error).toMatch(/could not/);
      expect(calls).toBe(1); // No hidden retry can prolong work or add provider cost.
      const retry = await app.inject(request);
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual(output);
      expect(calls).toBe(2);
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); await app.close(); }
  });
});

describe('selection cancellation', () => {
  for (const mode of ['auto', 'generated'] as const) it(`aborts real SDK ${mode} selections and promptly runs queued work`, async () => {
    const entry = searchPictures('cow', 'color')[0];
    const aborts: boolean[] = [];
    const release: (() => void)[] = [];
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => {
      const index = calls++;
      if (index < 2) return new Promise((_resolve, reject) => {
        aborts[index] = false;
        const stop = () => reject(new DOMException('Aborted', 'AbortError'));
        release.push(stop);
        init.signal!.addEventListener('abort', () => { aborts[index] = true; stop(); });
      });
      return Promise.resolve(new Response(JSON.stringify({ id: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ id: mode === 'auto' ? entry.id : 'generated' }), annotations: [] }] }] }), { headers: { 'Content-Type': 'application/json' } }));
    }));
    const real = openAIPictureProvider({ OPENAI_API_KEY: 'test-key' })!;
    const { jobs, provider, png } = await service({ select: real.select });
    const picture = { kind: 'library' as const, assetId: createHash('sha256').update(png).digest('hex'), style: entry.style, provenance: entry.provenance };
    vi.spyOn(jobs, 'library').mockResolvedValue({ entry, picture, bytes: png });
    const requests = [0, 1, 2].map(() => ({ ...input(), mode, concept: { ...input().concept, description: 'cow', searchTerms: ['cow'] } }));
    try {
      for (const request of requests) await jobs.start(request);
      await vi.waitFor(() => expect(calls).toBe(2));
      expect((await jobs.status(requests[2].requestId))?.state).toBe('queued');
      await Promise.all(requests.slice(0, 2).map(request => jobs.cancel(request.requestId)));
      await vi.waitFor(() => expect(aborts).toEqual([true, true]), { timeout: 1000 });
      expect((await finished(jobs, requests[2].requestId)).state).toBe('complete');
      expect(calls).toBe(3);
      for (const request of requests.slice(0, 2)) { const stopped = await jobs.status(request.requestId); expect(stopped?.state).toBe('cancelled'); expect(stopped?.result).toBeUndefined(); }
      expect(provider.generate).toHaveBeenCalledTimes(mode === 'auto' ? 0 : 3);
    } finally { jobs.close(); release.forEach(stop => stop()); vi.unstubAllGlobals(); }
  });
  it('does not cache a late selection from cancelled generated work', async () => {
    let release!: (id: string) => void;
    const pending = new Promise<string>(resolve => { release = resolve; });
    const select = vi.fn().mockImplementationOnce(() => pending).mockResolvedValue('generated');
    const { jobs } = await service({ select }, true, 1);
    const first = input(), second = input();
    await jobs.start(first);
    await vi.waitFor(() => expect(select).toHaveBeenCalledTimes(1));
    await jobs.start(second);
    await jobs.cancel(first.requestId);
    release('generated'); // A non-cooperative provider must not leak this abandoned result into reuse.
    expect((await finished(jobs, second.requestId)).state).toBe('complete');
    expect(select).toHaveBeenCalledTimes(2);
    const stopped = await jobs.status(first.requestId); expect(stopped?.state).toBe('cancelled'); expect(stopped?.result).toBeUndefined();
  });
});
