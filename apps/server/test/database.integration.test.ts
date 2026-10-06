/** @file Exercises real PostgreSQL migration compatibility, atomic transactions, and disposable schema isolation. */
import pg from 'pg';
import { PG_MIGRATE_LOCK_ID } from 'node-pg-migrate';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { checkDatabase, migrateDatabase, SCHEMA_VERSIONS, transaction } from '../src/database';
import { testDatabase } from './postgres-fixture';

let database: Awaited<ReturnType<typeof testDatabase>>;
beforeEach(async () => { database = await testDatabase(); });
afterEach(async () => { await database?.close(); });

it('initializes account and grant tables and repeats migrations without duplicate versions', async () => {
  await checkDatabase(database.pool);
  await migrateDatabase({ ...database.config, options: undefined }, database.schema);
  await checkDatabase(database.pool);
  const versions = await database.pool.query('SELECT name FROM pgmigrations ORDER BY id');
  expect(versions.rows.map(row => row.name)).toEqual(SCHEMA_VERSIONS);
  const tables = await database.pool.query('SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename', [database.schema]);
  expect(tables.rows.map(row => row.tablename)).toEqual(['account_assets', 'account_deletions', 'account_snapshots', 'accounts', 'browser_sessions', 'chatgpt_sessions', 'chatgpt_transactions', 'pgmigrations', 'revoked_browser_sessions']);
});

it('appends accounts to an existing grant database without changing its rows or prior ledger', async () => {
  await database.pool.query('DROP TABLE account_assets, account_deletions, account_snapshots, browser_sessions, revoked_browser_sessions, accounts');
  await database.pool.query('DELETE FROM pgmigrations WHERE name=$1', [SCHEMA_VERSIONS[2]]);
  await database.pool.query('INSERT INTO chatgpt_sessions VALUES ($1,$2,$3)', ['retained-grant', 'opaque-encrypted-fixture', 9999999999999]);
  const before = (await database.pool.query('SELECT id,name,run_on FROM pgmigrations ORDER BY id')).rows;
  await migrateDatabase(database.config, database.schema);
  expect((await database.pool.query('SELECT id,name,run_on FROM pgmigrations ORDER BY id')).rows.slice(0, 2)).toEqual(before);
  expect((await database.pool.query('SELECT * FROM chatgpt_sessions')).rows).toEqual([{ id: 'retained-grant', value: 'opaque-encrypted-fixture', expires: '9999999999999' }]);
  await expect(checkDatabase(database.pool)).resolves.toBeUndefined();
});

it('rejects an unmigrated schema and becomes ready after explicit migration', async () => {
  await database.pool.query('DROP TABLE account_assets, account_deletions, account_snapshots, browser_sessions, revoked_browser_sessions, accounts, chatgpt_transactions, chatgpt_sessions, pgmigrations');
  await expect(checkDatabase(database.pool)).rejects.toThrow();
  await migrateDatabase(database.config, database.schema);
  await expect(checkDatabase(database.pool)).resolves.toBeUndefined();
});

it('refuses migration while another session owns the migration lock and recovers after release', async () => {
  const owner = await database.pool.connect();
  try {
    await owner.query('SELECT pg_advisory_lock($1)', [PG_MIGRATE_LOCK_ID]);
    await expect(migrateDatabase(database.config, database.schema)).rejects.toThrow('Another migration is already running');
  } finally {
    await owner.query('SELECT pg_advisory_unlock($1)', [PG_MIGRATE_LOCK_ID]);
    owner.release();
  }
  await migrateDatabase(database.config, database.schema);
  await expect(checkDatabase(database.pool)).resolves.toBeUndefined();
});

it.each(['missing', 'future', 'legacy'])('rejects %s migration history', async variant => {
  if (variant === 'missing') await database.pool.query('DELETE FROM pgmigrations');
  else if (variant === 'future') await database.pool.query("INSERT INTO pgmigrations (name, run_on) VALUES ('1760000000001_unknown', now())");
  else await database.pool.query("UPDATE pgmigrations SET name = '1760000000000_initial'");
  await expect(checkDatabase(database.pool)).rejects.toThrow('Postgres schema is incompatible');
});

it('refuses to report migration success for an unknown newer history and preserves that history', async () => {
  await database.pool.query("INSERT INTO pgmigrations (name, run_on) VALUES ('1760000000001_unknown', now())");
  await expect(migrateDatabase(database.config, database.schema)).rejects.toThrow('Postgres schema is incompatible');
  expect((await database.pool.query('SELECT name FROM pgmigrations ORDER BY id')).rows.map(row => row.name)).toEqual([...SCHEMA_VERSIONS, '1760000000001_unknown']);
});

it('commits successful work, rolls back failed work, and releases the only connection for recovery', async () => {
  const pool = new pg.Pool({ ...database.config, max: 1, connectionTimeoutMillis: 1000 });
  try {
    await pool.query('CREATE TABLE atomic_work (id integer PRIMARY KEY)');
    const result = await transaction(pool, async client => {
      await client.query('INSERT INTO atomic_work VALUES (1)');
      return 'committed';
    });
    expect(result).toBe('committed');
    await expect(transaction(pool, async client => {
      await client.query('INSERT INTO atomic_work VALUES (2)');
      await client.query('INSERT INTO atomic_work VALUES (1)');
    })).rejects.toMatchObject({ code: '23505' });
    await transaction(pool, async client => { await client.query('INSERT INTO atomic_work VALUES (3)'); });
    expect((await pool.query('SELECT id FROM atomic_work ORDER BY id')).rows).toEqual([{ id: 1 }, { id: 3 }]);
  } finally { await pool.end(); }
});

it('keeps fixture schemas independent and removes only the closed fixture schema', async () => {
  const other = await testDatabase();
  try {
    await other.pool.query('CREATE TABLE retained_fixture (id integer PRIMARY KEY)');
    await other.pool.query('INSERT INTO retained_fixture VALUES (7)');
    expect((await database.pool.query("SELECT to_regclass('retained_fixture') AS relation")).rows[0].relation).toBeNull();
  } finally { await other.close(); }
  expect((await database.pool.query('SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1', [other.schema])).rows).toEqual([]);
  await expect(checkDatabase(database.pool)).resolves.toBeUndefined();
});
