/** @file Verifies parallel hosted board generation, shared image fairness, and capacity recovery with PostgreSQL. */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it, vi } from 'vitest';
import { type GeneratedBoard } from '@little-say/core';
import { Accounts, type Identity } from '../src/accounts/store';
import { Jobs, type Job } from '../src/hosting/jobs';
import { readAiLimits } from '../src/hosting/limits';
import { executeJob } from '../src/hosting/runtime';
import { FileObjects } from '../src/hosting/storage';
import { testDatabase } from './postgres-fixture';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), generate: vi.fn() }));
vi.mock('../src/provider', () => ({ openAIProvider: () => ({ prepare: mocks.prepare }) }));
vi.mock('../src/pictures/provider', () => ({ openAIPictureProvider: () => ({ model: 'capacity-fixture', generate: mocks.generate, validate: async () => true }) }));

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.resetAllMocks(); });

async function setup(env: NodeJS.ProcessEnv = {}) {
  const db = await testDatabase(); cleanup.push(() => db.close());
  const root = await mkdtemp(join(tmpdir(), 'little-say-image-capacity-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const limits = readAiLimits(env), accounts = new Accounts(db.pool);
  const identity: Identity = { project: 'demo-little-say', uid: randomUUID(), email: 'parent@example.test', emailVerified: true, displayName: null,
    providers: ['password'], authTime: Date.now() / 1000, expires: Date.now() / 1000 + 3600 };
  const alice = await accounts.provision(identity), bob = await accounts.provision({ ...identity, uid: randomUUID() });
  return { pool: db.pool, objects: new FileObjects(root), jobs: new Jobs(db.pool, true, limits), other: new Jobs(db.pool, true, limits), alice, bob, env: {} };
}

function draft(name: string): GeneratedBoard {
  return { title: `${name} board`, explanation: 'Fixture board', needsClarification: false,
    picturePolicy: { mode: 'generated', style: 'color', consistent: false }, playLanguages: ['en-US'],
    tiles: Array.from({ length: 9 }, (_, index) => {
      const label = `${name} geometric pattern ${index + 1}`;
      return { existingId: null, label, speech: label, language: 'en-US', translations: [], emoji: '🟠', color: 'sage',
        pictureConcept: { description: label, features: [], searchTerms: [label], emojiAccurate: false }, pictureOptions: { instruction: '', locked: false } };
    }) };
}

it('starts nine independent image calls for one board and gives a second board the remaining capacity while speech is active', async () => {
  const f = await setup();
  const held = new Map<string, () => void>();
  let open = false, peak = 0;
  let sample = 0;
  mocks.prepare.mockImplementation(async (request: { prompt: string }) => draft(request.prompt));
  mocks.generate.mockImplementation(async (concept: { description: string }) => {
    const color = ++sample;
    if (!open) await new Promise<void>(resolve => { held.set(concept.description, resolve); peak = Math.max(peak, held.size); });
    return sharp({ create: { width: 32, height: 32, channels: 4, background: { r: color, g: 40, b: 140, alpha: 1 } } }).png().toBuffer();
  });

  const speech = await f.jobs.submit(f.alice.id, randomUUID(), 'speech', { text: 'background clip' });
  const spoken = (await f.jobs.claim(speech.id))!;
  const controller = new AbortController(), work: Promise<unknown>[] = [];
  const start = async (account: string, prompt: string, jobs: Jobs) => {
    const id = randomUUID();
    await jobs.submit(account, id, 'proposal', { prompt, board: null, preparationId: id });
    const job = await jobs.claim(id);
    expect(job).not.toBeNull();
    const done = executeJob({ ...f, jobs }, job!, controller.signal).then(async result => { await jobs.finish(job!, result); return result; });
    void done.catch(() => {}); work.push(done);
    return { id, job: job!, done };
  };
  const waitForImages = (done: Promise<unknown>, count: number) => Promise.race([
    done.then(() => { throw new Error('The board finished before its expected image calls started.'); }),
    vi.waitFor(() => expect(held.size).toBe(count), { timeout: 5000 }),
  ]);
  try {
    const alice = await start(f.alice.id, 'First', f.jobs);
    await waitForImages(alice.done, 9);
    expect(await f.jobs.get(f.alice.id, alice.id)).toMatchObject({ state: 'working', result: { proposal: { title: 'First board' } } });

    const queued = new AbortController(), paid = vi.fn();
    const beyondAccountCap = f.other.images.run(alice.job, queued.signal, paid);
    void beyondAccountCap.catch(() => {});
    try {
      await vi.waitFor(async () => expect((await f.pool.query('SELECT id FROM ai_image_work WHERE NOT granted')).rowCount).toBe(1));
      expect(paid).not.toHaveBeenCalled();
    } finally {
      queued.abort();
      await expect(beyondAccountCap).rejects.toMatchObject({ name: 'AbortError' });
    }
    expect(paid).not.toHaveBeenCalled();

    const bob = await start(f.bob.id, 'Second', f.other);
    await waitForImages(bob.done, 12);
    expect(await f.jobs.get(f.bob.id, bob.id)).toMatchObject({ state: 'working', result: { proposal: { title: 'Second board' } } });
    expect(mocks.generate).toHaveBeenCalledTimes(12);
    expect(await f.jobs.get(f.alice.id, speech.id)).toMatchObject({ state: 'working' });

    open = true; for (const release of held.values()) release();
    const results = await Promise.all(work);
    expect(results.every(result => (result as { preparation: { tiles: { state: string }[] } }).preparation.tiles.every(tile => tile.state === 'ready'))).toBe(true);
    expect(mocks.generate).toHaveBeenCalledTimes(18);
    expect(peak).toBe(12);
    expect((await f.pool.query('SELECT id FROM ai_image_work')).rowCount).toBe(0);
  } finally {
    controller.abort(); open = true; for (const release of held.values()) release();
    await Promise.allSettled(work);
    await f.jobs.finish(spoken, null);
  }
});

it('shares an account cap across its claims, favors another account when a slot clears, and removes abandoned tickets', async () => {
  const f = await setup({ AAC_AI_ACCOUNT_BOARD_CONCURRENCY: '2', AAC_AI_SERVICE_FOREGROUND_CONCURRENCY: '3',
    AAC_AI_ACCOUNT_IMAGE_CONCURRENCY: '2', AAC_AI_SERVICE_IMAGE_CONCURRENCY: '2' });
  const jobs = await Promise.all([f.alice, f.alice, f.bob].map(async account => {
    const id = randomUUID(); await f.jobs.submit(account.id, id, 'proposal', {}); return (await f.jobs.claim(id))!;
  }));
  const order: string[] = [], releases = new Map<string, () => void>(), signal = new AbortController();
  const reserve = (worker: Jobs, job: Job, label: string) => worker.images.run(job, signal.signal, () => new Promise<void>(resolve => {
    order.push(label); releases.set(label, resolve);
  }));
  const work: Promise<unknown>[] = [];
  const enqueue = (worker: Jobs, job: Job, label: string) => {
    const workItem = reserve(worker, job, label); void workItem.catch(() => {}); work.push(workItem);
  };
  try {
    enqueue(f.jobs, jobs[0], 'alice-first'); enqueue(f.other, jobs[1], 'alice-second');
    await vi.waitFor(() => expect(order).toHaveLength(2));
    enqueue(f.jobs, jobs[0], 'alice-waiting');
    enqueue(f.other, jobs[2], 'bob');
    await vi.waitFor(async () => expect((await f.pool.query('SELECT id FROM ai_image_work WHERE NOT granted')).rowCount).toBe(2));
    releases.get('alice-first')!();
    await vi.waitFor(() => expect(order[2]).toBe('bob'));
    expect(order).not.toContain('alice-waiting');

    // Reclaim only the lost job. The other account's live call keeps its slot.
    await f.pool.query("UPDATE ai_jobs SET heartbeat=now()-interval '2 minutes' WHERE id=$1", [jobs[1].id]);
    await f.jobs.reconcile();
    await vi.waitFor(() => expect(order[3]).toBe('alice-waiting'));
    expect((await f.pool.query('SELECT job_id FROM ai_image_work WHERE granted')).rows.map(row => row.job_id).sort()).toEqual([jobs[0].id, jobs[2].id].sort());
  } finally {
    signal.abort(); for (const release of releases.values()) release();
    await Promise.allSettled(work);
  }
});
