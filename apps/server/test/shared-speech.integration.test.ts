/** @file Verifies cross-account speech reuse, claim serialization, regeneration, deletion retention, and migration of existing clips. */

import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStarterBoards } from '@little-say/core';
import { Accounts, type Identity } from '../src/accounts/store';
import { migrateDatabase } from '../src/database';
import { Jobs } from '../src/hosting/jobs';
import { executeJob } from '../src/hosting/runtime';
import { validateJobInput } from '../src/hosting/api';
import { DatabaseCache, FileObjects, canReadMedia, pruneMedia } from '../src/hosting/storage';
import { SpeechCache } from '../src/speech-cache';
import { pcmToWav, speechProfile } from '../src/synthesis';
import { testDatabase } from './postgres-fixture';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const profile = speechProfile({});
const input = { text: 'Horse', language: 'en-US' };
const wav = (sample = 0) => pcmToWav(Buffer.alloc(100, sample));
async function setup() {
  const db = await testDatabase(); cleanup.push(() => db.close());
  const root = await mkdtemp(join(tmpdir(), 'little-say-shared-speech-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const accounts = new Accounts(db.pool), jobs = new Jobs(db.pool), objects = new FileObjects(root);
  const identity: Identity = { project: 'demo-little-say', uid: randomUUID(), email: 'parent@example.test', emailVerified: true, displayName: null, providers: ['password'], authTime: Date.now() / 1000, expires: Date.now() / 1000 + 3600 };
  const alice = await accounts.provision(identity), bob = await accounts.provision({ ...identity, uid: randomUUID() });
  return { ...db, root, accounts, jobs, objects, identity, alice, bob };
}

it('reuses every starter word across accounts and worker restarts with no synthesis provider on the second account', async () => {
  const f = await setup();
  for (const tile of createStarterBoards(randomUUID).flatMap(board => board.tiles)) {
    const input = { text: tile.speech, language: tile.language };
    const first = randomUUID(), second = randomUUID();
    await f.jobs.submit(f.alice.id, first, 'speech', input);
    const job = (await f.jobs.claim(first))!;
    const generated = await executeJob({ ...f, env: { AAC_AI_FIXTURES: 'true' } }, job, new AbortController().signal);
    await f.jobs.finish(job, generated);
    await f.jobs.submit(f.bob.id, second, 'speech', input);
    const next = (await f.jobs.claim(second))!;
    const reused = await executeJob({ ...f, objects: new FileObjects(f.root), env: {} }, next, new AbortController().signal);
    await f.jobs.finish(next, reused);
    expect(reused).toMatchObject({ ...(generated as object), cacheHit: true });
  }
  const pointers = (await f.pool.query("SELECT account_id FROM service_records WHERE namespace='speech'")).rows;
  expect(pointers).toHaveLength(18); expect(pointers.every(row => row.account_id === null)).toBe(true);
});

it('serializes equivalent speech across worker claims while allowing unrelated words to run', async () => {
  const f = await setup(), other = new Jobs(f.pool);
  const first = randomUUID(), duplicate = randomUUID(), unrelated = randomUUID();
  await f.jobs.submit(f.alice.id, first, 'speech', validateJobInput('speech', input));
  await f.jobs.submit(f.bob.id, duplicate, 'speech', validateJobInput('speech', { text: ' Horse ', language: 'en-us' }));
  await f.jobs.submit(f.bob.id, unrelated, 'speech', { text: 'Cow', language: 'en-US' });
  const claims = await Promise.all([f.jobs.claim(first), other.claim(duplicate)]);
  const active = claims.find(job => job !== null)!;
  expect(claims.filter(Boolean)).toHaveLength(1);
  const waiting = active.id === first ? duplicate : first;
  const different = await other.claim(unrelated); expect(different).not.toBeNull();
  const generated = await executeJob({ ...f, env: { AAC_AI_FIXTURES: 'true' } }, active, new AbortController().signal);
  await f.jobs.finish(active, generated);
  const next = (await other.claim(waiting))!;
  expect(await executeJob({ ...f, env: {} }, next, new AbortController().signal)).toMatchObject({ cacheHit: true });
  await f.jobs.finish(next, null); await f.jobs.finish(different!, null);
});

it('releases matching queued speech after an interrupted operation without replaying its request', async () => {
  const f = await setup(), first = randomUUID(), second = randomUUID();
  await f.jobs.submit(f.alice.id, first, 'speech', input); await f.jobs.submit(f.bob.id, second, 'speech', input);
  const claim = (await f.jobs.claim(first))!;
  expect(await f.jobs.claim(second)).toBeNull();
  await f.jobs.finish(claim, null, true);
  expect(await f.jobs.claim(first)).toBeNull(); expect(await f.jobs.claim(second)).not.toBeNull();
});

it('retains reusable speech after its only owner is deleted and grants the next requester access', async () => {
  const f = await setup();
  const first = new SpeechCache(new DatabaseCache(f.pool, f.objects, 'speech', f.alice.id), profile, async () => wav());
  const saved = await first.get(input);
  await f.accounts.requestDeletion(f.alice, f.identity); await f.accounts.processDeletions(f.identity.project, async () => {});
  await pruneMedia(f.pool, f.objects);
  expect(await canReadMedia(f.pool, 'speech', saved.id + '.wav')).toBe(false);
  expect(await canReadMedia(f.pool, 'speech', saved.id + '.wav', f.bob.id)).toBe(false);
  const second = new SpeechCache(new DatabaseCache(f.pool, new FileObjects(f.root), 'speech', f.bob.id), profile, null);
  expect(await second.get(input)).toEqual({ id: saved.id, cacheHit: true });
  expect(await canReadMedia(f.pool, 'speech', saved.id + '.wav', f.bob.id)).toBe(true);
  expect(await second.read(saved.id)).toEqual(wav());
});

it('reuses the shared replacement take but keeps synthesis profiles and immutable URLs distinct', async () => {
  const f = await setup(), generate = vi.fn().mockResolvedValueOnce(wav()).mockResolvedValueOnce(wav(1));
  const first = new SpeechCache(new DatabaseCache(f.pool, f.objects, 'speech', f.alice.id), profile, generate);
  const second = new SpeechCache(new DatabaseCache(f.pool, f.objects, 'speech', f.bob.id), profile, generate);
  const original = await first.get(input), fresh = await second.get(input, true);
  expect(await first.get(input)).toEqual({ id: fresh.id, cacheHit: true });
  expect(fresh.id).not.toBe(original.id); expect(await first.read(original.id)).toEqual(wav());
  expect(await new SpeechCache(new DatabaseCache(f.pool, f.objects, 'speech', f.bob.id), { ...profile, voice: 'other' }, null).lookup([input])).toEqual([]);
  expect(await second.lookup([{ ...input, language: 'fr-FR' }])).toEqual([]);
  expect(generate).toHaveBeenCalledTimes(2);
});

it('promotes existing owner pointers without losing clips, download grants, or an established shared take', async () => {
  const f = await setup();
  const storage = new DatabaseCache(f.pool, f.objects, 'speech', f.alice.id);
  const saved = await new SpeechCache(storage, profile, async () => wav()).get(input);
  const pointer = (await f.pool.query("SELECT key,value FROM service_records WHERE namespace='speech'")).rows[0];
  const alternate = createHash('sha256').update(wav(1)).digest('hex'); await storage.write(alternate + '.wav', wav(1));
  await f.pool.query('INSERT INTO service_records(namespace,key,value,account_id) VALUES($1,$2,$3,$4)', ['speech/owner-' + f.alice.id, pointer.key, JSON.stringify({ id: alternate }), f.alice.id]);
  const secondKey = 'f'.repeat(64) + '.json';
  await f.pool.query('INSERT INTO service_records(namespace,key,value,account_id) VALUES($1,$2,$3,$4)', ['speech/owner-' + f.alice.id, secondKey, JSON.stringify({ id: alternate }), f.alice.id]);
  // Recreate only this disposable schema's pre-feature state, then exercise the real migration.
  await f.pool.query('ALTER TABLE media_objects DROP COLUMN service_owned');
  await f.pool.query('DROP INDEX ai_jobs_working_speech');
  await f.pool.query("DELETE FROM pgmigrations WHERE name='1760000000005_shared_speech'");
  await migrateDatabase(f.config, f.schema);
  expect(JSON.parse((await storage.read(pointer.key)).toString())).toEqual({ id: saved.id });
  expect(JSON.parse((await storage.read(secondKey)).toString())).toEqual({ id: alternate });
  expect((await f.pool.query("SELECT count(*) FROM service_records WHERE namespace='speech' AND account_id IS NULL")).rows[0].count).toBe('2');
  expect((await f.pool.query("SELECT count(*) FROM service_records WHERE namespace=$1", ['speech/owner-' + f.alice.id])).rows[0].count).toBe('2');
  await f.accounts.requestDeletion(f.alice, f.identity); await f.accounts.processDeletions(f.identity.project, async () => {}); await pruneMedia(f.pool, f.objects);
  expect(await f.objects.read('speech/' + saved.id + '.wav')).toEqual(wav());
  expect(await f.objects.read('speech/' + alternate + '.wav')).toEqual(wav(1));
});
