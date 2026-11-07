/** @file Verifies real starter seeds, shared-account reuse, repeatable initialization, public playback, and guest generation boundaries in Postgres. */
import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts, type Identity } from '../src/accounts/store';
import type { IdentityService } from '../src/accounts/firebase';
import { AccountAccess } from '../src/accounts/access';
import { Jobs } from '../src/hosting/jobs';
import { apiCaches, executeJob } from '../src/hosting/runtime';
import { DatabaseCache, FileObjects, canReadMedia } from '../src/hosting/storage';
import { createServer } from '../src/app';
import { seedStarterSpeech } from '../src/seed-speech';
import { SpeechCache } from '../src/speech-cache';
import { pcmToWav } from '../src/synthesis';
import { testDatabase } from './postgres-fixture';
import manifest from '../seeds/speech/manifest.json';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup() {
  const db = await testDatabase(); cleanup.push(() => db.close());
  const root = await mkdtemp(join(tmpdir(), 'little-say-seeded-speech-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const objects = new FileObjects(root), accounts = new Accounts(db.pool), jobs = new Jobs(db.pool);
  const identity: Identity = { project: 'demo-little-say', uid: randomUUID(), email: 'parent@example.test', emailVerified: true, displayName: null, providers: ['password'], authTime: Date.now() / 1000, expires: Date.now() / 1000 + 3600 };
  const account = await accounts.provision(identity);
  const auth: IdentityService = {
    config: { projectId: identity.project, appId: 'demo-app', apiKey: 'demo-key', authDomain: 'localhost', providers: ['password'] },
    /** Return the enrolled test identity without a provider call. */
    async verify() { return identity; },
    /** No external session is needed by these bearer-authenticated tests. */
    async cookie() { return 'fixture'; },
    /** This fixture owns no external user. */
    async deleteUser() {},
    /** This fixture owns no Apple grant. */
    async revokeApple() {},
    /** This fixture owns no resources. */
    async close() {},
  };
  const hosting = { pool: db.pool, jobs, objects, enabled: false, access: new AccountAccess(accounts, auth) };
  const caches = apiCaches({ ...hosting, env: {} });
  const app = await createServer({ provider: null, ...caches, accounts, auth, hosting }); cleanup.push(() => app.close());
  return { ...db, ...hosting, ...caches, app, account };
}
const headers = { 'x-little-say': '1' };

it('initializes an empty database with all real clips and reuses them through guest and registered playback without providers', async () => {
  const f = await setup();
  expect(await seedStarterSpeech(f.pool, f.objects)).toBe(18);
  for (const clip of manifest.clips) {
    const input = { text: clip.text, language: clip.language };
    const response = await f.app.inject({ method: 'POST', url: '/api/speech', headers, payload: input });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ...input, id: clip.id, cacheHit: true });
    const download = await f.app.inject(`/api/speech/${clip.id}.wav`);
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(await readFile(new URL(`../seeds/speech/audio/${clip.id}.wav`, import.meta.url)));
    const id = randomUUID(); await f.jobs.submit(f.account.id, id, 'speech', input);
    const job = (await f.jobs.claim(id))!;
    const reused = await executeJob({ ...f, env: {} }, job, new AbortController().signal);
    expect(reused).toEqual(response.json()); await f.jobs.finish(job, reused);
  }
  await seedStarterSpeech(f.pool, f.objects);
  expect((await f.pool.query("SELECT * FROM service_records WHERE namespace='speech' AND account_id IS NULL")).rowCount).toBe(18);
  expect((await f.pool.query("SELECT * FROM media_objects WHERE namespace='speech' AND public")).rowCount).toBe(18);
});

it('preserves newer shared takes on reseeding and uses the same updated take for guests', async () => {
  const f = await setup(), input = { text: 'Horse', language: 'en-US' };
  await seedStarterSpeech(f.pool, f.objects);
  const ordinary = new SpeechCache(new DatabaseCache(f.pool, f.objects, 'speech', f.account.id), manifest.profile, async () => pcmToWav(Buffer.alloc(100, 1)));
  const replacement = await ordinary.get(input, true);
  expect(await canReadMedia(f.pool, 'speech', replacement.id + '.wav')).toBe(false);
  const response = await f.app.inject({ method: 'POST', url: '/api/speech', headers, payload: input });
  expect(response.json()).toEqual({ ...input, id: replacement.id, cacheHit: true });
  expect((await f.app.inject(`/api/speech/${replacement.id}.wav`)).statusCode).toBe(200);
  await seedStarterSpeech(f.pool, f.objects);
  expect(await f.speechCache.lookup([input])).toEqual([{ ...input, id: replacement.id }]);
  expect(await new SpeechCache(new DatabaseCache(f.pool, f.objects, 'speech'), { ...manifest.profile, voice: 'other' }, null).lookup([input])).toEqual([]);
});

it('denies anonymous cache misses, regeneration, private words, and private downloads without creating jobs', async () => {
  const f = await setup(), input = { text: 'Horse', language: 'en-US' };
  expect((await f.app.inject({ method: 'POST', url: '/api/speech', headers, payload: input })).statusCode).toBe(401);
  await seedStarterSpeech(f.pool, f.objects);
  const privateInput = { text: 'A private sentence', language: 'en-US' };
  const privateCache = new SpeechCache(new DatabaseCache(f.pool, f.objects, 'speech', f.account.id), manifest.profile, async () => pcmToWav(Buffer.alloc(100, 2)));
  const privateClip = await privateCache.get(privateInput);
  for (const payload of [{ ...input, regenerate: true }, { ...input, language: 'fr-FR' }, privateInput]) {
    expect((await f.app.inject({ method: 'POST', url: '/api/speech', headers, payload })).statusCode).toBe(401);
  }
  expect((await f.app.inject(`/api/speech/${privateClip.id}.wav`)).statusCode).toBe(401);
  expect((await f.app.inject({ method: 'POST', url: '/api/speech', headers: { ...headers, origin: 'https://untrusted.example' }, payload: input })).statusCode).toBe(403);
  expect((await f.pool.query('SELECT * FROM ai_jobs')).rowCount).toBe(0);
});
