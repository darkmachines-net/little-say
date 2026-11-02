/** @file Exercises atomic account seeding, real Postgres backups, concurrent quotas/revisions, isolation, and deletion retries. */
import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { Accounts, type Identity } from '../src/accounts/store';
import { checkDatabase, migrateDatabase, SCHEMA_VERSIONS } from '../src/database';
import { testDatabase } from './postgres-fixture';
import { starterLibrary } from '../../../tests/fixtures/library';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const identity = (uid: string): Identity => ({ project: 'demo-little-say', uid, email: uid + '@example.test', displayName: null, emailVerified: true, providers: ['password'], authTime: Date.now() / 1000, expires: Date.now() / 1000 + 3600 });
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture(quota?: number) { const db = await testDatabase(); cleanup.push(() => db.close()); return { ...db, accounts: new Accounts(db.pool, quota) }; }

it('applies empty-database migrations once and verifies the exact compatible schema', async () => {
  const db = await fixture();
  await migrateDatabase(db.config, db.schema); await checkDatabase(db.pool);
  expect((await db.pool.query('SELECT count(*) FROM pgmigrations')).rows[0].count).toBe(String(SCHEMA_VERSIONS.length));
});
it('provisions by project and UID, never by email, even under concurrent sign-in', async () => {
  const { accounts } = await fixture();
  const [a, b] = await Promise.all([accounts.provision(identity('alice')), accounts.provision(identity('alice'))]);
  expect(a.id).toBe(b.id);
  const starters = await accounts.snapshot(a);
  expect(starters.boards.map(board => board.title)).toEqual(['Farm Animals', 'Rainbow', 'Shapes']);
  expect(starters.boards.every(board => board.tiles.length === 6)).toBe(true);
  expect(await accounts.starterSnapshot(b)).toEqual(starters);
  expect((await accounts.provision({ ...identity('bob'), email: a.email })).id).not.toBe(a.id);
  expect((await accounts.provision({ ...identity('alice'), project: 'different-project' })).id).not.toBe(a.id);
});
it('never reseeds edited, emptied, or legacy accounts and never exposes private edits in session starters', async () => {
  const { accounts, pool } = await fixture();
  const account = await accounts.provision(identity('parent'));
  const initial = await accounts.snapshot(account);
  const edited = { ...initial, boards: [{ ...initial.boards[0], title: 'My animals', revision: 1 }] };
  const saved = await accounts.save(account, edited);
  await accounts.provision(identity('parent'));
  expect(await accounts.snapshot(account)).toEqual(saved);
  expect(await accounts.starterSnapshot(account)).toBeUndefined();
  await accounts.save(account, { ...saved, boards: [] });
  await accounts.provision(identity('parent'));
  expect((await accounts.snapshot(account)).boards).toEqual([]);
  // A revision-zero empty snapshot is the pre-starter account format.
  await pool.query('UPDATE account_snapshots SET revision=0 WHERE account_id=$1', [account.id]);
  await accounts.provision(identity('parent'));
  expect((await accounts.snapshot(account)).boards).toEqual([]);
  expect(await accounts.starterSnapshot(account)).toBeUndefined();
});
it('persists complete owner-scoped backups across pool recreation and rejects missing/corrupt assets', async () => {
  const db = await fixture(), alice = await db.accounts.provision(identity('alice')), bob = await db.accounts.provision(identity('bob'));
  const board = starterLibrary().boards[0]; board.tiles[0].illustration = { kind: 'photo', assetId: 'family', zoom: 2, x: 0.3, y: -0.2 };
  const bytes = Buffer.from('private photo'), hash = digest(bytes);
  const snapshot = { revision: 0, boards: [board], assets: [{ kind: 'photo' as const, id: 'family', hash }] };
  await expect(db.accounts.save(alice, snapshot)).rejects.toMatchObject({ statusCode: 400 });
  await expect(db.accounts.putAsset(alice, 'a'.repeat(64), bytes)).rejects.toMatchObject({ statusCode: 400 });
  await db.accounts.putAsset(alice, hash, bytes);
  expect((await db.accounts.save(alice, snapshot)).revision).toBe(1);
  expect(await db.accounts.asset(bob, hash)).toBeNull();
  await expect(db.accounts.save(bob, snapshot)).rejects.toMatchObject({ statusCode: 400 });
  const pool = new pg.Pool(db.config);
  try { const restarted = new Accounts(pool); expect(await restarted.snapshot(alice)).toEqual({ ...snapshot, revision: 1 }); expect(await restarted.asset(alice, hash)).toEqual(bytes); }
  finally { await pool.end(); }
});
it('allows exactly one writer at a shared revision across independent repositories', async () => {
  const db = await fixture(), other = new Accounts(db.pool), account = await db.accounts.provision(identity('parent'));
  const result = await Promise.allSettled([db.accounts.save(account, { revision: 0, boards: [], assets: [] }), other.save(account, { revision: 0, boards: [], assets: [] })]);
  expect(result.filter(value => value.status === 'fulfilled')).toHaveLength(1);
  expect(result.find(value => value.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
});
it('serializes duplicate uploads and quota checks under contention', async () => {
  const db = await fixture(10), account = await db.accounts.provision(identity('parent'));
  const bytes = Buffer.from('123456');
  await Promise.all([db.accounts.putAsset(account, digest(bytes), bytes), db.accounts.putAsset(account, digest(bytes), bytes)]);
  const result = await Promise.allSettled([Buffer.from('abc'), Buffer.from('def')].map(value => db.accounts.putAsset(account, digest(value), value)));
  expect(result.filter(value => value.status === 'fulfilled')).toHaveLength(1);
  expect((await db.pool.query('SELECT sum(octet_length(bytes)) AS bytes FROM account_assets')).rows[0].bytes).toBe('9');
});
it('persists deletion intent, blocks access immediately, retries failure, and retains a non-personal UID tombstone', async () => {
  const db = await fixture(), who = identity('parent'), account = await db.accounts.provision(who);
  const bytes = Buffer.from('private'); await db.accounts.putAsset(account, digest(bytes), bytes);
  await db.accounts.requestDeletion(account, who);
  await expect(db.accounts.find(who)).rejects.toMatchObject({ statusCode: 410 });
  await expect(db.accounts.provision(who)).rejects.toMatchObject({ statusCode: 410 });
  const remove = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(undefined);
  await db.accounts.processDeletions(who.project, remove);
  expect((await db.pool.query('SELECT completed FROM account_deletions')).rows[0].completed).toBe(false);
  await db.pool.query('UPDATE account_deletions SET retry_after=now()');
  await new Accounts(db.pool).processDeletions(who.project, remove);
  expect((await db.pool.query('SELECT count(*) FROM account_assets')).rows[0].count).toBe('0');
  expect((await db.pool.query('SELECT completed FROM account_deletions')).rows[0].completed).toBe(true);
  await expect(db.accounts.provision(who)).rejects.toMatchObject({ statusCode: 410 });
});
it('revokes only the selected browser cookie and expires its revocation record', async () => {
  const { accounts, pool } = await fixture();
  const account = await accounts.provision(identity('browser'));
  const first = await accounts.issueCookie(account, 'identical-firebase-token', Date.now() / 1000 + 60);
  const second = await accounts.issueCookie(account, 'identical-firebase-token', Date.now() / 1000 + 60);
  expect(first).not.toBe(second);
  await accounts.logout(first, Date.now() / 1000 + 60);
  await expect(accounts.checkCookie(first)).rejects.toMatchObject({ statusCode: 401 });
  await expect(accounts.checkCookie('f'.repeat(64) + first.slice(64))).rejects.toMatchObject({ statusCode: 401 });
  expect(await accounts.checkCookie(second)).toBe('identical-firebase-token');
  await pool.query("UPDATE web_sessions SET expires=now()-interval '1 second'");
  await expect(accounts.checkCookie(second)).rejects.toMatchObject({ statusCode: 401 });
});

it('persists Apple-gated deletion without allowing workers to delete before fresh confirmation', async () => {
  const db = await fixture(), who = identity('apple-parent'), account = await db.accounts.provision(who);
  await db.accounts.requestDeletion(account, who, true);
  const remove = vi.fn().mockResolvedValue(undefined);
  const restarted = new Accounts(db.pool);
  await restarted.processDeletions(who.project, remove);
  expect(remove).not.toHaveBeenCalled();
  await expect(restarted.find(who)).rejects.toMatchObject({ statusCode: 410 });
  expect((await restarted.find(who, true)).id).toBe(account.id);
  expect(await restarted.provision(who)).toMatchObject({ id: account.id, deletionPending: true });
  await restarted.requestDeletion(account, who, true);
  await restarted.confirmDeletion(who);
  await restarted.processDeletions(who.project, remove);
  expect(remove).toHaveBeenCalledExactlyOnceWith(who.uid);
});
