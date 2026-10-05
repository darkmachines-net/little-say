/** @file Validates Postgres connections and owns pooled transactions, migrations, and schema readiness. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg, { type PoolClient, type PoolConfig } from 'pg';
import { runner } from 'node-pg-migrate';

// Append each feature migration in application order; never edit an applied migration.
export const SCHEMA_VERSIONS = ['1760000000000_foundation'] as const;
const migrations = fileURLToPath(new URL('../migrations/', import.meta.url));

function integer(value: string | undefined, fallback: number, max: number) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error('Invalid Postgres port or pool size.');
  return number;
}

/** Read one connection contract for localhost, Compose, and authenticated Cloud SQL sockets. */
export function databaseConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const host = env.PGHOST || '127.0.0.1';
  const local = ['localhost', '127.0.0.1', '::1', 'postgres'].includes(host) || host.startsWith('/');
  const sslmode = env.PGSSLMODE || (local ? 'disable' : 'verify-full');
  if (!['disable', 'verify-full'].includes(sslmode) || (!local && sslmode !== 'verify-full')) throw new Error('Remote Postgres requires PGSSLMODE=verify-full.');
  if (!env.PGDATABASE || !env.PGUSER || !env.PGPASSWORD) throw new Error('Set PGDATABASE, PGUSER, and PGPASSWORD for the selected Postgres database.');
  return { host, port: integer(env.PGPORT, 5432, 65535), database: env.PGDATABASE, user: env.PGUSER, password: env.PGPASSWORD,
    max: integer(env.PGPOOL_MAX, 3, 100), connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, options: env.PGOPTIONS,
    ssl: sslmode === 'verify-full' ? { rejectUnauthorized: true, ...(env.PGSSLROOTCERT ? { ca: readFileSync(env.PGSSLROOTCERT, 'utf8') } : {}) } : false };
}

/** Create a process-owned pool; callers drain HTTP work before ending it. */
export function createDatabase(env: NodeJS.ProcessEnv = process.env) {
  const pool = new pg.Pool(databaseConfig(env));
  pool.on('error', () => console.error('An idle Postgres connection failed. New requests will reconnect.'));
  return pool;
}

/** Run atomic work on one checked-out connection, always rolling back and releasing on failure. */
export async function transaction<T>(pool: pg.Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await action(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

/** Apply packaged SQL migrations with the migration library's advisory lock and transaction. */
export async function migrateDatabase(config: PoolConfig, schema = 'public') {
  await runner({ databaseUrl: config, dir: migrations, schema, migrationsTable: 'pgmigrations', direction: 'up', singleTransaction: true, checkOrder: true, log: () => {} });
}

/** Reject an unmigrated or incompatible schema without exposing database connection details. */
export async function checkDatabase(pool: pg.Pool) {
  const result = await pool.query('SELECT name FROM pgmigrations ORDER BY id');
  if (result.rows.length !== SCHEMA_VERSIONS.length || result.rows.some((row, index) => row.name !== SCHEMA_VERSIONS[index])) throw new Error('Postgres schema is incompatible. Run db:migrate with the selected server release.');
}
