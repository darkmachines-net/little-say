/** @file Starts the real API against a unique test schema and the Auth emulator, then removes only its owned schema. */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { testDatabase } from '../apps/server/test/postgres-fixture';
if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Browser tests require the local Firebase Auth emulator.');
const fixture = await testDatabase();
const child = spawn(process.execPath, ['dist/index.js'], { cwd: resolve('apps/server'), stdio: 'inherit', windowsHide: true, env: {
  ...process.env, NODE_ENV: 'test', PGHOST: fixture.config.host, PGPORT: String(fixture.config.port), PGDATABASE: fixture.config.database,
  PGUSER: fixture.config.user, PGPASSWORD: String(fixture.config.password), PGOPTIONS: fixture.config.options,
  PORT: '4175', HOST: '127.0.0.1', WEB_ROOT: resolve('apps/mobile/dist'), ALLOWED_ORIGINS: 'http://127.0.0.1:4175',
  AAC_OPENAI_KEY: '', OPENAI_API_KEY: '', CHATGPT_ENABLED: 'false',
  FIREBASE_PROJECT_ID: 'demo-little-say', FIREBASE_API_KEY: 'demo-key', FIREBASE_APP_ID: 'demo-app', FIREBASE_AUTH_PROVIDERS: 'password',
  FIREBASE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
} });
let closing = false;
async function stop(code: number) { if (closing) return; closing = true; child.kill(); await fixture.close(); process.exitCode = code; }
child.once('error', () => { void stop(1); });
child.once('exit', code => { void stop(code ?? 0); });
process.once('SIGTERM', () => { void stop(0); });
process.once('SIGINT', () => { void stop(0); });
