/** @file Runs explicit Postgres migration/status commands; never prints credentials or automatically rolls back. */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { checkDatabase, createDatabase, databaseConfig, migrateDatabase, grantRuntimeAccess } from './database';
config({ path: resolve(process.cwd(), '../../.env'), quiet: true });
config({ quiet: true });
try {
  const command = process.argv[2];
  if (command === 'migrate') {
    const connection = databaseConfig(); await migrateDatabase(connection);
    if (process.env.RUNTIME_DB_USER) await grantRuntimeAccess(connection, process.env.RUNTIME_DB_USER);
    console.log('Postgres migrations applied.');
  }
  else if (command === 'status') {
    const pool = createDatabase();
    try { await checkDatabase(pool); console.log('Postgres is reachable and its schema is compatible.'); } finally { await pool.end(); }
  } else throw new Error('Use database-cli migrate or status.');
} catch { console.error('Database command failed. Check Postgres configuration, availability, and the migration version. No credentials are logged.'); process.exitCode = 1; }
