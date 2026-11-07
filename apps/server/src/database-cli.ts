/** @file Runs Postgres migration/status and shared speech seeding; never prints credentials or rolls back automatically. */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { checkDatabase, createDatabase, databaseConfig, migrateDatabase, grantRuntimeAccess } from './database';
import { seedStarterSpeech } from './seed-speech';
import { FileObjects } from './hosting/storage';
import { GoogleObjects } from './hosting/google';
config({ path: resolve(process.cwd(), '../../.env'), quiet: true });
config({ quiet: true });
try {
  const command = process.argv[2];
  if (command === 'migrate') {
    const connection = databaseConfig(); await migrateDatabase(connection);
    if (process.env.RUNTIME_DB_USER) await grantRuntimeAccess(connection, process.env.RUNTIME_DB_USER);
    console.log('Postgres migrations applied.');
  }
  else if (command === 'seed-speech') {
    const pool = createDatabase();
    try {
      await checkDatabase(pool);
      const objects = process.env.MEDIA_BUCKET ? new GoogleObjects(process.env.MEDIA_BUCKET) : new FileObjects(resolve(process.env.MEDIA_DIRECTORY || '../../.cache/media'));
      console.log(`Shared speech cache initialized with ${await seedStarterSpeech(pool, objects)} starter words.`);
    } finally { await pool.end(); }
  }
  else if (command === 'status') {
    const pool = createDatabase();
    try { await checkDatabase(pool); console.log('Postgres is reachable and its schema is compatible.'); } finally { await pool.end(); }
  } else throw new Error('Use database-cli migrate, seed-speech, or status.');
} catch { console.error('Database command failed. Check Postgres configuration, availability, and the migration version. No credentials are logged.'); process.exitCode = 1; }
