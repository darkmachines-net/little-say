/** @file Verifies durable jobs, duplicate delivery, interruption, owner grants, and real API session contracts against isolated PostgreSQL. */
import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts, type Identity } from '../src/accounts/store';
import { type IdentityService } from '../src/accounts/firebase';
import { AccountAccess } from '../src/accounts/access';
import { Jobs } from '../src/hosting/jobs';
import { FileObjects, DatabaseCache, canReadMedia, pruneMedia } from '../src/hosting/storage';
import { executeJob, apiCaches } from '../src/hosting/runtime';
import { createServer } from '../src/app';
import { testDatabase } from './postgres-fixture';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function setup() {
  const db = await testDatabase(); cleanup.push(() => db.close());
  const root = await mkdtemp(join(tmpdir(), 'little-say-hosting-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const accounts = new Accounts(db.pool), jobs = new Jobs(db.pool), objects = new FileObjects(root);
  const identity: Identity = { project: 'demo-little-say', uid: randomUUID(), email: 'parent@example.test', emailVerified: true, displayName: null, providers: ['password'], authTime: Date.now() / 1000, expires: Date.now() / 1000 + 3600 };
  const alice = await accounts.provision(identity), bob = await accounts.provision({ ...identity, uid: randomUUID() });
  return { ...db, root, accounts, jobs, objects, identity, alice, bob };
}
it('removes deleted account records and unowned media while retaining another owner and public assets', async () => {
  const f = await setup(), alice = new DatabaseCache(f.pool, f.objects, 'pictures', f.alice.id);
  const bob = new DatabaseCache(f.pool, f.objects, 'pictures', f.bob.id);
  await alice.write('private.png', 'private'); await alice.write('shared.png', 'shared'); await alice.write('catalog.png', 'catalog');
  await alice.write('index.json', JSON.stringify({ private: true }));
  await bob.read('shared.png');
  await f.pool.query("UPDATE media_objects SET public=true WHERE key='catalog.png'");
  await f.accounts.requestDeletion(f.alice, f.identity);
  await f.accounts.processDeletions(f.identity.project, async () => {});
  await pruneMedia(f.pool, f.objects);
  expect(await f.objects.read('pictures/private.png')).toBeNull();
  expect(await canReadMedia(f.pool, 'pictures', 'shared.png', f.bob.id)).toBe(true);
  expect(await canReadMedia(f.pool, 'pictures', 'catalog.png')).toBe(true);
  expect((await f.pool.query('SELECT * FROM service_records WHERE account_id=$1', [f.alice.id])).rowCount).toBe(0);
  expect((await f.objects.read('pictures/shared.png'))?.toString()).toBe('shared');
});
it('serializes admission, immutable identifiers, owner reads, and the global execution limit across repositories', async () => {
  const f = await setup(), id = randomUUID(), other = new Jobs(f.pool);
  const admitted = await Promise.all(Array.from({ length: 6 }, () => other.submit(f.alice.id, id, 'speech', { text: 'Hello' })));
  expect(new Set(admitted.map(job => job.id)).size).toBe(1);
  await expect(f.jobs.submit(f.alice.id, id, 'speech', { text: 'Changed' })).rejects.toMatchObject({ statusCode: 409 });
  await expect(f.jobs.submit(f.bob.id, id, 'speech', { text: 'Hello' })).rejects.toMatchObject({ statusCode: 404 });
  expect(await other.get(f.bob.id, id)).toBeNull();
  await f.jobs.submit(f.alice.id, randomUUID(), 'speech', {});
  await expect(other.submit(f.alice.id, randomUUID(), 'speech', {})).rejects.toMatchObject({ statusCode: 429 });
  await f.jobs.submit(f.bob.id, randomUUID(), 'speech', {});
  const claims = (await Promise.all([f.jobs.claim(), other.claim(), f.jobs.claim(), other.claim()])).filter(value => value !== null);
  expect(claims).toHaveLength(2); expect(new Set(claims.map(job => job.id)).size).toBe(2);
  expect(await f.jobs.claim(id)).toBeNull();
  await other.finish(claims[0], { completed: true });
  expect(await f.jobs.claim()).not.toBeNull();
});
it('enforces the durable per-minute limit and operator kill switch without hiding existing job state', async () => {
  const f = await setup();
  for (let count = 0; count < 30; count++) {
    const id = randomUUID(); await f.jobs.submit(f.alice.id, id, 'speech', {}); await f.jobs.cancel(f.alice.id, id);
  }
  await expect(new Jobs(f.pool).submit(f.alice.id, randomUUID(), 'speech', {})).rejects.toMatchObject({ statusCode: 429 });
  const id = randomUUID(); await f.jobs.submit(f.bob.id, id, 'speech', {});
  const disabled = new Jobs(f.pool, false);
  expect(await disabled.get(f.bob.id, id)).toMatchObject({ state: 'queued' });
  expect(await disabled.claim(id)).toBeNull();
  await expect(disabled.submit(f.bob.id, randomUUID(), 'speech', {})).rejects.toMatchObject({ statusCode: 503 });
});
it('retains dispatch intent on enqueue failure and never replays interrupted or completed provider work', async () => {
  const f = await setup(), id = randomUUID();
  await f.jobs.submit(f.alice.id, id, 'speech', {});
  await expect(f.jobs.dispatch(async () => { throw new Error('queue unavailable'); })).rejects.toThrow('queue unavailable');
  const notifications: string[] = [];
  await new Jobs(f.pool).dispatch(async value => { notifications.push(value); }); expect(notifications).toEqual([id]);
  const claim = (await f.jobs.claim(id))!;
  expect(await new Jobs(f.pool).claim(id)).toBeNull();
  await f.pool.query("UPDATE ai_jobs SET heartbeat=now()-interval '2 minutes' WHERE id=$1", [id]);
  await f.jobs.reconcile(); await f.jobs.finish(claim, { stale: true });
  expect(await f.jobs.get(f.alice.id, id)).toMatchObject({ state: 'interrupted', result: null });
  expect(await f.jobs.claim(id)).toBeNull();
  expect(await f.jobs.submit(f.alice.id, id, 'speech', {})).toMatchObject({ state: 'interrupted' });
});
it('honors cancellation before admission and during execution without publishing late results', async () => {
  const f = await setup(), early = randomUUID();
  await f.jobs.cancel(f.alice.id, early);
  expect(await f.jobs.submit(f.alice.id, early, 'speech', {})).toMatchObject({ state: 'cancelled' });
  const running = randomUUID(); await f.jobs.submit(f.alice.id, running, 'speech', {});
  const job = (await f.jobs.claim(running))!;
  await f.jobs.cancel(f.bob.id, running); expect(await f.jobs.heartbeat(job)).toBe(true);
  await f.jobs.cancel(f.alice.id, running); expect(await f.jobs.heartbeat(job)).toBe(false);
  await f.jobs.progress(job, { tooLate: true }); await f.jobs.finish(job, { tooLate: true });
  expect(await f.jobs.get(f.alice.id, running)).toMatchObject({ state: 'cancelled', result: null });
});
it('persists fixture speech through a worker restart and grants downloads only to authorized owners', async () => {
  const f = await setup(), id = randomUUID(), input = { text: 'Hello', language: 'en' };
  await f.jobs.submit(f.alice.id, id, 'speech', input); const job = (await f.jobs.claim(id))!;
  const result = await executeJob({ pool: f.pool, jobs: f.jobs, objects: f.objects, env: { AAC_AI_FIXTURES: 'true' } }, job, new AbortController().signal) as { id: string };
  await f.jobs.finish(job, result);
  expect(await new Jobs(f.pool).get(f.alice.id, id)).toMatchObject({ state: 'complete', result });
  const key = result.id + '.wav', restarted = new FileObjects(f.root);
  expect((await restarted.read('speech/' + key))?.subarray(0, 4).toString()).toBe('RIFF');
  expect(await canReadMedia(f.pool, 'speech', key)).toBe(false);
  expect(await canReadMedia(f.pool, 'speech', key, f.bob.id)).toBe(false);
  expect(await canReadMedia(f.pool, 'speech', key, f.alice.id)).toBe(true);
  const cache = new DatabaseCache(f.pool, restarted, 'speech', f.bob.id);
  await cache.read(key); expect(await canReadMedia(f.pool, 'speech', key, f.bob.id)).toBe(true);
  await cache.write('contract.json', JSON.stringify({ durable: true }));
  expect((await new DatabaseCache(f.pool, restarted, 'speech', f.bob.id).read('contract.json')).toString()).toBe('{"durable":true}');
  await expect(new DatabaseCache(f.pool, restarted, 'speech', f.alice.id).read('contract.json')).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(restarted.read('../escape')).rejects.toThrow('Invalid storage key');
});
it('uses only __session for browser AI, enforces CSRF and verification, and protects direct media and job URLs', async () => {
  const f = await setup();
  const auth: IdentityService = {
    config: { projectId: 'demo-little-say', appId: 'demo-app', apiKey: 'demo-key', authDomain: 'localhost', providers: ['password'] },
    /** Return only this fixture's enrolled identity. */
    async verify() { return f.identity; },
    /** Substitute a non-provider fixture token; cookies remain opaque at the API boundary. */
    async cookie() { return 'firebase-fixture'; },
    /** No external identity exists for this fixture. */
    async deleteUser() {},
    /** No external Apple grant exists for this fixture. */
    async revokeApple() {},
    /** This adapter owns no resources. */
    async close() {},
  };
  const hosting = { pool: f.pool, jobs: f.jobs, objects: f.objects, enabled: true, access: new AccountAccess(f.accounts, auth) };
  const caches = apiCaches({ ...hosting, env: {} });
  const app = await createServer({ provider: null, ...caches, accounts: f.accounts, auth, hosting, secureCookies: true }); cleanup.push(() => app.close());
  const csrf = await app.inject('/api/account/csrf'), initialCookie = String(csrf.headers['set-cookie']).split(';')[0];
  const login = await app.inject({ method: 'POST', url: '/api/account/session', headers: { cookie: initialCookie, 'x-little-say': '1', 'x-little-say-csrf': csrf.json().csrfToken }, payload: { idToken: 'fixture' } });
  expect(login.statusCode).toBe(200); expect(login.headers['set-cookie']).toMatch(/^__session=[a-f0-9]{64}; Path=\/api; HttpOnly; SameSite=Strict;.*Secure$/);
  const headers = { cookie: String(login.headers['set-cookie']).split(';')[0], 'x-little-say': '1', 'x-little-say-csrf': csrf.json().csrfToken };
  const id = randomUUID(), payload = { id, kind: 'speech', input: { text: 'Hello', language: 'en' } };
  expect((await app.inject({ method: 'POST', url: '/api/ai/jobs', headers: { ...headers, 'x-little-say-csrf': 'wrong' }, payload })).statusCode).toBe(403);
  f.identity.emailVerified = false;
  expect((await app.inject({ method: 'POST', url: '/api/ai/jobs', headers, payload })).statusCode).toBe(403);
  f.identity.emailVerified = true;
  const accepted = await app.inject({ method: 'POST', url: '/api/ai/jobs', headers, payload }); expect(accepted.statusCode).toBe(202);
  expect((await app.inject(`/api/ai/jobs/${id}`)).statusCode).toBe(401);
  const job = (await f.jobs.claim(id))!;
  const result = await executeJob({ ...hosting, env: { AAC_AI_FIXTURES: 'true' } }, job, new AbortController().signal) as { id: string }; await f.jobs.finish(job, result);
  const media = '/api/speech/' + result.id + '.wav';
  expect((await app.inject(media)).statusCode).toBe(401);
  expect((await app.inject({ url: media, headers })).statusCode).toBe(200);
  expect((await app.inject({ url: `/api/ai/jobs/${id}`, headers })).json()).toMatchObject({ state: 'complete', result });
});
