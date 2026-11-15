/** @file Verifies default and configured job capacity, durable claim recovery, and authorized media access. */
import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts, type Identity } from '../src/accounts/store';
import { type IdentityService } from '../src/accounts/firebase';
import { AccountAccess } from '../src/accounts/access';
import { Jobs } from '../src/hosting/jobs';
import { readAiLimits } from '../src/hosting/limits';
import { FileObjects, DatabaseCache, canReadMedia, pruneMedia } from '../src/hosting/storage';
import { executeJob, apiCaches } from '../src/hosting/runtime';
import { createServer } from '../src/app';
import { testDatabase } from './postgres-fixture';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function setup(env: NodeJS.ProcessEnv = {}) {
  const db = await testDatabase(); cleanup.push(() => db.close());
  const root = await mkdtemp(join(tmpdir(), 'little-say-hosting-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const accounts = new Accounts(db.pool), jobs = new Jobs(db.pool, true, readAiLimits(env)), objects = new FileObjects(root);
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
  const f = await setup({ AAC_AI_SERVICE_SPEECH_CONCURRENCY: '2' }), id = randomUUID(), other = new Jobs(f.pool, true, f.jobs.limits);
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
it('runs eight foreground and four speech jobs independently while a second board waits on the same account', async () => {
  const f = await setup(), other = new Jobs(f.pool);
  const additionalAccounts = await Promise.all(Array.from({ length: 7 }, () => f.accounts.provision({ ...f.identity, uid: randomUUID() })));
  const speechAccounts = [f.alice, f.alice, f.bob, ...additionalAccounts.slice(0, 2)];
  const speech = await Promise.all(speechAccounts.map((account, index) => f.jobs.submit(account.id, randomUUID(), 'speech', { text: String(index), language: 'en' })));
  for (const item of speech.slice(0, 4)) expect(await f.jobs.claim(item.id)).toMatchObject({ kind: 'speech', state: 'working' });
  expect(await f.jobs.claim(speech[4].id)).toBeNull();
  const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => other.submit(f.alice.id, randomUUID(), 'proposal', {})));
  const admitted = attempts.filter(result => result.status === 'fulfilled').map(result => result.value);
  expect(admitted).toHaveLength(2);
  expect(attempts.filter(result => result.status === 'rejected').map(result => result.reason.statusCode)).toEqual([429, 429]);
  await expect(f.jobs.submit(f.alice.id, randomUUID(), 'speech', {})).rejects.toMatchObject({ statusCode: 429, retryAfterSeconds: 2, message: 'Audio is still being prepared. Please try again shortly.' });
  expect(await f.jobs.submit(f.alice.id, randomUUID(), 'translation', {})).toMatchObject({ state: 'queued' });
  const board = (await other.claim(admitted[0].id))!;
  expect(board).toMatchObject({ kind: 'proposal', state: 'working' });
  expect(await other.claim(admitted[1].id)).toBeNull();
  const secondAccount = await f.jobs.submit(f.bob.id, randomUUID(), 'proposal', {});
  expect(await f.jobs.claim()).toMatchObject({ id: secondAccount.id, state: 'working' });
  const moreBoards = await Promise.all(additionalAccounts.map(account => f.jobs.submit(account.id, randomUUID(), 'proposal', {})));
  const moreClaims = await Promise.all(moreBoards.map(job => other.claim(job.id)));
  expect(moreClaims.filter(Boolean)).toHaveLength(6);
  expect(await f.jobs.claim()).toBeNull();
  await other.finish(board, { board: true });
  expect(await f.jobs.claim(admitted[1].id)).toMatchObject({ state: 'working' });
  expect(await f.jobs.get(f.alice.id, board.id)).toMatchObject({ state: 'complete', result: { board: true } });
});
it.each([
  { label: 'default speech', kind: 'speech', rate: 30, override: undefined },
  { label: 'default board', kind: 'proposal', rate: 2, override: undefined },
  { label: 'configured board', kind: 'proposal', rate: 3, override: '3' },
] as const)('reports $label rate exhaustion even after work has finished and isolates the allowance', async ({ kind, rate, override }) => {
  const f = await setup({ AAC_AI_ACCOUNT_BOARD_STARTS_PER_MINUTE: override });
  let last = '';
  for (let count = 0; count < rate; count++) {
    last = randomUUID();
    await f.jobs.submit(f.alice.id, last, kind, {});
    await f.jobs.finish((await f.jobs.claim(last))!, {});
  }
  await f.pool.query("UPDATE ai_jobs SET created_at=now()-interval '25 seconds' WHERE id=$1", [last]);
  await expect(f.jobs.submit(f.alice.id, randomUUID(), kind, {})).rejects.toMatchObject({ statusCode: 429, retryAfterSeconds: 35, message: `Too many ${kind === 'proposal' ? 'board' : 'AI'} requests in the last minute. Please try again shortly.` });
  expect(await f.jobs.submit(f.alice.id, last, kind, {})).toMatchObject({ state: 'complete' });
  expect(await f.jobs.submit(f.alice.id, randomUUID(), kind === 'speech' ? 'proposal' : 'speech', {})).toMatchObject({ state: 'queued' });
  if (kind === 'proposal') expect(await f.jobs.submit(f.alice.id, randomUUID(), 'translation', {})).toMatchObject({ state: 'queued' });
  await f.pool.query("UPDATE ai_jobs SET created_at=now()-interval '2 minutes' WHERE account_id=$1", [f.alice.id]);
  expect(await f.jobs.submit(f.alice.id, randomUUID(), kind, {})).toMatchObject({ state: 'queued' });
});
it('releases expired account capacity on admission without maintenance and preserves healthy claims and request identity', async () => {
  const f = await setup({ AAC_AI_ACCOUNT_BOARD_CONCURRENCY: '2', AAC_AI_ACCOUNT_BOARD_STARTS_PER_MINUTE: '6' });
  const stale = randomUUID(), healthy = randomUUID(), next = randomUUID(), other = new Jobs(f.pool, true, f.jobs.limits);
  await f.jobs.submit(f.alice.id, stale, 'proposal', {}); await f.jobs.submit(f.alice.id, healthy, 'proposal', {});
  const lost = (await f.jobs.claim(stale))!, current = (await f.jobs.claim(healthy))!;
  await f.jobs.progress(lost, { partial: true });
  await f.pool.query("UPDATE ai_jobs SET heartbeat=now()-interval '2 minutes' WHERE id=$1", [stale]);
  expect(await other.submit(f.alice.id, next, 'proposal', {})).toMatchObject({ state: 'queued' });
  expect(await f.jobs.heartbeat(lost)).toBe('lost');
  expect(await f.jobs.heartbeat(current)).toBe('active');
  await f.jobs.progress(lost, { late: true }); await f.jobs.finish(lost, { late: true });
  expect(await f.jobs.get(f.alice.id, stale)).toMatchObject({ state: 'interrupted', result: null });
  expect(await f.jobs.submit(f.alice.id, stale, 'proposal', {})).toMatchObject({ state: 'interrupted' });
  expect(await f.jobs.claim(stale)).toBeNull();
  await expect(f.jobs.submit(f.alice.id, randomUUID(), 'proposal', {})).rejects.toMatchObject({ statusCode: 429 });
});
it('recovers expired global execution slots on claim without replaying abandoned work', async () => {
  const f = await setup({ AAC_AI_ACCOUNT_BOARD_CONCURRENCY: '2', AAC_AI_SERVICE_FOREGROUND_CONCURRENCY: '2' });
  const ids = [randomUUID(), randomUUID()], next = randomUUID(), other = new Jobs(f.pool, true, f.jobs.limits);
  for (const id of ids) { await f.jobs.submit(f.alice.id, id, 'proposal', {}); await f.jobs.claim(id); }
  await f.jobs.submit(f.bob.id, next, 'proposal', {});
  await f.pool.query("UPDATE ai_jobs SET heartbeat=now()-interval '2 minutes' WHERE account_id=$1", [f.alice.id]);
  expect(await other.claim(next)).toMatchObject({ id: next, state: 'working' });
  for (const id of ids) {
    expect(await f.jobs.get(f.alice.id, id)).toMatchObject({ state: 'interrupted' });
    expect(await f.jobs.claim(id)).toBeNull();
  }
});
it.each([false, true])('settles a lost claim on owner polling without maintenance (cancel requested=%s)', async cancelled => {
  const f = await setup(), id = randomUUID();
  await f.jobs.submit(f.alice.id, id, 'proposal', {});
  const job = (await f.jobs.claim(id))!;
  if (cancelled) await f.jobs.cancel(f.alice.id, id);
  await f.pool.query("UPDATE ai_jobs SET heartbeat=now()-interval '2 minutes' WHERE id=$1", [id]);
  expect(await new Jobs(f.pool).get(f.alice.id, id)).toMatchObject({ state: cancelled ? 'cancelled' : 'interrupted', result: null });
  expect(await f.jobs.heartbeat(job)).toBe('lost');
  await f.jobs.finish(job, { late: true });
  expect(await f.jobs.get(f.alice.id, id)).toMatchObject({ state: cancelled ? 'cancelled' : 'interrupted', result: null });
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
  await f.jobs.cancel(f.bob.id, running); expect(await f.jobs.heartbeat(job)).toBe('active');
  await f.jobs.cancel(f.alice.id, running); expect(await f.jobs.heartbeat(job)).toBe('cancelled');
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
  await new DatabaseCache(f.pool, restarted, 'pictures', f.bob.id).write('contract.json', JSON.stringify({ durable: true }));
  expect((await new DatabaseCache(f.pool, restarted, 'pictures', f.bob.id).read('contract.json')).toString()).toBe('{"durable":true}');
  await expect(new DatabaseCache(f.pool, restarted, 'pictures', f.alice.id).read('contract.json')).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(restarted.read('../escape')).rejects.toThrow('Invalid storage key');
});
it.each([false, true])('requires registered accounts for AI (anonymous=%s), exposes admission retry timing, and protects CSRF, media and backups', async anonymous => {
  const f = await setup();
  Object.assign(f.identity, { emailVerified: false, ...(anonymous ? { email: null, providers: [] } : {}) });
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
  const login = await app.inject({ method: 'POST', url: '/api/account/session', headers: { cookie: initialCookie, 'x-little-say': '1', 'x-little-say-csrf': csrf.json().csrfToken }, payload: { idToken: 'fixture', guest: anonymous } });
  if (anonymous) {
    expect(login.statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/ai/jobs', headers: { authorization: 'Bearer legacy', 'x-little-say': '1' }, payload: { id: randomUUID(), kind: 'speech', input: { text: 'Hello', language: 'en' } } })).statusCode).toBe(401);
    return;
  }
  expect(login.statusCode).toBe(200); expect(login.headers['set-cookie']).toMatch(/^__session=[a-f0-9]{64}; Path=\/api; HttpOnly; SameSite=Strict;.*Secure$/);
  const headers = { cookie: String(login.headers['set-cookie']).split(';')[0], 'x-little-say': '1', 'x-little-say-csrf': csrf.json().csrfToken };
  const id = randomUUID(), payload = { id, kind: 'speech', input: { text: 'Hello', language: 'en' } };
  expect((await app.inject({ method: 'POST', url: '/api/ai/jobs', headers: { ...headers, 'x-little-say-csrf': 'wrong' }, payload })).statusCode).toBe(403);
  expect((await app.inject({ url: '/api/account/backup', headers })).statusCode).toBe(403);
  const accepted = await app.inject({ method: 'POST', url: '/api/ai/jobs', headers, payload }); expect(accepted.statusCode).toBe(202);
  const queued = randomUUID(), rejected = randomUUID();
  await f.jobs.submit(f.alice.id, queued, 'speech', { text: 'Another clip', language: 'en' });
  const origin = 'http://localhost:8081';
  const directThrottle = await app.inject({ method: 'POST', url: '/api/ai/jobs', headers: { ...headers, origin }, payload: { ...payload, id: rejected } });
  const legacyThrottle = await app.inject({ method: 'POST', url: '/api/speech', headers: { ...headers, origin, 'x-little-say-request': rejected }, payload: payload.input });
  for (const response of [directThrottle, legacyThrottle]) {
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('2');
    expect(response.headers['access-control-expose-headers']).toBe('Retry-After');
    expect(response.json()).toMatchObject({ error: 'Audio is still being prepared. Please try again shortly.' });
  }
  expect(await f.jobs.get(f.alice.id, rejected)).toBeNull();
  await f.jobs.cancel(f.alice.id, queued);
  expect((await app.inject(`/api/ai/jobs/${id}`)).statusCode).toBe(401);
  const job = (await f.jobs.claim(id))!;
  const result = await executeJob({ ...hosting, env: { AAC_AI_FIXTURES: 'true' } }, job, new AbortController().signal) as { id: string }; await f.jobs.finish(job, result);
  const media = '/api/speech/' + result.id + '.wav';
  expect((await app.inject(media)).statusCode).toBe(401);
  expect((await app.inject({ url: media, headers })).statusCode).toBe(200);
  expect((await app.inject({ url: `/api/ai/jobs/${id}`, headers })).json()).toMatchObject({ state: 'complete', result });
  const previous = f.identity.uid; f.identity.uid = randomUUID(); await f.accounts.provision(f.identity);
  expect((await app.inject({ url: `/api/ai/jobs/${id}`, headers: { authorization: 'Bearer other' } })).statusCode).toBe(404);
  expect((await app.inject({ url: media, headers: { authorization: 'Bearer other' } })).statusCode).toBe(404);
  const reusedId = randomUUID(), otherHeaders = { authorization: 'Bearer other', 'x-little-say': '1', 'x-little-say-request': reusedId };
  expect((await app.inject({ method: 'POST', url: '/api/speech', headers: otherHeaders, payload: payload.input })).statusCode).toBe(202);
  const reusedJob = (await f.jobs.claim(reusedId))!;
  const reused = await executeJob({ ...hosting, env: {} }, reusedJob, new AbortController().signal);
  await f.jobs.finish(reusedJob, reused);
  expect(reused).toMatchObject({ id: result.id, cacheHit: true });
  expect((await app.inject({ url: media, headers: otherHeaders })).statusCode).toBe(200);
  expect((await app.inject({ url: `/api/ai/jobs/${id}`, headers: otherHeaders })).statusCode).toBe(404);
  await app.inject({ method: 'POST', url: `/api/ai/jobs/${id}/cancel`, headers: { authorization: 'Bearer other', 'x-little-say': '1' } });
  f.identity.uid = previous;
  expect((await app.inject({ url: `/api/ai/jobs/${id}`, headers })).json()).toMatchObject({ state: 'complete', result });
});
