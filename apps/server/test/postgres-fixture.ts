/** @file Creates isolated schemas only inside an explicitly named test database and removes only those schemas. */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { databaseConfig, migrateDatabase } from '../src/database';

/** Require explicit test credentials; never infer a destructive test target from application PG settings. */
export async function testDatabase() {
  const database = process.env.TEST_PGDATABASE;
  if (!database?.endsWith('_test') || !process.env.TEST_PGPASSWORD) throw new Error('Integration tests require TEST_PGDATABASE ending in _test and TEST_PGPASSWORD; see docs/testing.md.');
  const config = databaseConfig({ PGHOST: process.env.TEST_PGHOST || '127.0.0.1', PGPORT: process.env.TEST_PGPORT || '5432', PGDATABASE: database, PGUSER: process.env.TEST_PGUSER || 'little_say_test', PGPASSWORD: process.env.TEST_PGPASSWORD, PGSSLMODE: process.env.TEST_PGSSLMODE });
  const admin = new pg.Pool(config), schema = 'test_' + randomUUID().replaceAll('-', '');
  await admin.query('CREATE SCHEMA ' + schema);
  const isolated = { ...config, options: '-c search_path=' + schema };
  const pool = new pg.Pool(isolated);
  try { await migrateDatabase(isolated, schema); }
  catch (error) { await pool.end(); await admin.query('DROP SCHEMA ' + schema + ' CASCADE'); await admin.end(); throw error; }
  return { pool, config: isolated, schema,
    /** End fixture connections and drop only its generated schema, preserving all other schemas. */
    async close() { await pool.end(); await admin.query('DROP SCHEMA ' + schema + ' CASCADE'); await admin.end(); },
  };
}
