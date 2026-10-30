/** @file Owns Postgres connections, pooled transactions, SQL migration discovery, and schema readiness. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg, { type PoolClient, type PoolConfig } from 'pg';
import { runner } from 'node-pg-migrate';

// Append each feature migration in application order; never edit an applied migration.
export const SCHEMA_VERSIONS = ['1760000000000_foundation', '1760000000002_accounts', '1760000000003_hosting', '1760000000004_private_cache'] as const;
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

/** Apply locked, transactional SQL migrations beside module documentation and reject incompatible histories. */
export async function migrateDatabase(config: PoolConfig, schema = 'public') {
  await runner({ databaseUrl: config, dir: migrations,
    // Exclude the module README while preserving the runner's default hidden-file exclusion.
    ignorePattern: '(\\..*|README\\.md)',
    schema, migrationsTable: 'pgmigrations', direction: 'up', singleTransaction: true, checkOrder: true, log: () => {} });
  const pool = new pg.Pool(config);
  try { await checkDatabase(pool, schema); } finally { await pool.end(); }
}

/** Restrict the separately provisioned Cloud SQL runtime role after additive migrations; never use this on the migrator itself. */
export async function grantRuntimeAccess(config: PoolConfig, runtime: string) {
  if (runtime === config.user || !/^[a-z][a-z0-9_]{0,62}$/.test(runtime)) throw new Error('A distinct runtime database role is required.');
  const pool = new pg.Pool(config), role = pg.escapeIdentifier(runtime), database = pg.escapeIdentifier(config.database!);
  try {
    await transaction(pool, async db => {
      await db.query(`REVOKE cloudsqlsuperuser FROM ${role}`);
      await db.query(`ALTER ROLE ${role} NOCREATEDB NOCREATEROLE`);
      await db.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
      await db.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
      await db.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
      await db.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
      await db.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
      await db.query(`REVOKE INSERT,UPDATE,DELETE ON public.pgmigrations FROM ${role}`);
      await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${role}`);
      await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO ${role}`);
      const privileges = (await db.query("SELECT rolcreatedb OR rolcreaterole OR rolsuper OR pg_has_role(oid, 'cloudsqlsuperuser', 'member') OR has_schema_privilege(oid,'public','CREATE') OR has_table_privilege(oid,'public.pgmigrations','INSERT,UPDATE,DELETE') AS elevated FROM pg_roles WHERE rolname=$1", [runtime])).rows[0];
      if (!privileges || privileges.elevated) throw new Error('Runtime database role still has administrative privileges.');
    });
  } finally { await pool.end(); }
}

/** Require the known additive migration prefix; newer additive migrations permit rolling older revisions. */
export async function checkDatabase(pool: pg.Pool, schema?: string) {
  const table = schema === undefined ? 'pgmigrations' : `${pg.escapeIdentifier(schema)}.pgmigrations`;
  const result = await pool.query(`SELECT name FROM ${table} ORDER BY id`);
  if (result.rows.length < SCHEMA_VERSIONS.length || SCHEMA_VERSIONS.some((name, index) => result.rows[index]?.name !== name) || result.rows.some((row, index) => !/^\d{13}_/.test(row.name) || (index > 0 && row.name <= result.rows[index - 1].name))) throw new Error('Postgres schema is incompatible. Run db:migrate with the selected server release.');
}
