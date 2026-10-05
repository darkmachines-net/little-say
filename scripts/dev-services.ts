/** @file Prepares only the selected local Postgres database and supplies isolated demo Firebase emulator settings. */
import { migrateDatabase, databaseConfig } from '../apps/server/src/database';
import { type DevelopmentConfig } from './dev-config';

/** Fill development-only defaults; hosted mode requires its real Firebase project configuration. */
export function developmentServices(env: NodeJS.ProcessEnv, config: DevelopmentConfig): NodeJS.ProcessEnv {
  const mode = env.DEV_AUTH_MODE || 'emulator';
  if (!['emulator', 'hosted'].includes(mode)) throw new Error('DEV_AUTH_MODE must be emulator or hosted.');
  if (mode === 'hosted' && (env.FIREBASE_AUTH_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_URL)) throw new Error('Remove emulator overrides before selecting hosted authentication.');
  return { ...env, PGHOST: env.PGHOST || '127.0.0.1', PGPORT: env.PGPORT || '5432', PGDATABASE: env.PGDATABASE || 'little_say', PGUSER: env.PGUSER || 'little_say', PGPASSWORD: env.PGPASSWORD || 'little_say_dev',
    ...(mode === 'emulator' ? { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_AUTH_EMULATOR_URL: 'http://' + config.host + ':9099', FIREBASE_PROJECT_ID: 'demo-little-say', FIREBASE_API_KEY: 'demo-key', FIREBASE_APP_ID: 'demo-app', FIREBASE_AUTH_DOMAIN: 'demo-little-say.firebaseapp.com', FIREBASE_AUTH_PROVIDERS: 'password' } : {}) };
}

/** Apply local migrations before API startup; an unavailable database never falls back to SQLite. */
export async function prepareDevelopmentDatabase(env: NodeJS.ProcessEnv) {
  try { await migrateDatabase(databaseConfig(env)); }
  catch { throw new Error('Local Postgres is unavailable or migration failed. Start your database (npm run db:up for Docker) and check PG settings.'); }
}
