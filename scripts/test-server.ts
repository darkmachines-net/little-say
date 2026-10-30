/** @file Starts the real API against a unique test schema and the Auth emulator, then removes only its owned schema. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { testDatabase } from '../apps/server/test/postgres-fixture';
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('Browser tests require the owned loopback Auth emulator.');
const fixture = await testDatabase();
const port = process.env.TEST_API_PORT || '4175';
Object.assign(process.env, {
  ...process.env, NODE_ENV: 'test', PGHOST: fixture.config.host, PGPORT: String(fixture.config.port), PGDATABASE: fixture.config.database,
  PGUSER: fixture.config.user, PGPASSWORD: String(fixture.config.password), PGOPTIONS: fixture.config.options,
  PORT: port, HOST: '127.0.0.1', WEB_ROOT: resolve('apps/mobile/dist'), ALLOWED_ORIGINS: 'http://127.0.0.1:' + port,
  AAC_OPENAI_KEY: '', OPENAI_API_KEY: '',
  FIREBASE_PROJECT_ID: 'demo-little-say', FIREBASE_API_KEY: 'demo-key', FIREBASE_APP_ID: 'demo-app', FIREBASE_AUTH_PROVIDERS: 'password',
  FIREBASE_AUTH_EMULATOR_URL: 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST,
});
await import(pathToFileURL(resolve('apps/server/dist/index.js')).href);
let closing = false;
async function stop(code: number) { if (closing) return; closing = true; await fixture.close(); process.exitCode = code; }
process.once('SIGTERM', () => { void stop(0); });
process.once('SIGINT', () => { void stop(0); });
