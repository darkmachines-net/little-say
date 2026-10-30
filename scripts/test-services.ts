/** @file Runs service or browser tests with disposable Compose dependencies, credentials, and media isolated from development. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import pg from 'pg';
import { localEnvironment, localCompose } from './local-services';

const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url);
async function port(): Promise<string> {
  const server = createServer();
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const selected = String((server.address() as { port: number }).port);
  await new Promise<void>(done => server.close(() => done())); return selected;
}
const project = 'little-say-test-' + randomUUID().slice(0, 8);
const media = await mkdtemp(join(tmpdir(), project + '-'));
if (!resolve(media).startsWith(resolve(tmpdir()) + sep + project + '-')) throw new Error('Refusing cleanup outside this test media directory.');
const env = localEnvironment(root, { ...process.env, DEV_PG_PORT: await port(), DEV_AUTH_PORT: await port() }, '127.0.0.1', project);
Object.assign(env, { AAC_OPENAI_KEY: '', OPENAI_API_KEY: '', AAC_AI_FIXTURES: 'true', AAC_AI_ENABLED: 'true', MEDIA_DIRECTORY: media,
  TEST_API_PORT: await port(),
  TEST_RESULTS_DIR: resolve(root, 'artifacts', 'tests', project),
  TEST_PGHOST: env.PGHOST, TEST_PGPORT: env.PGPORT, TEST_PGDATABASE: 'little_say_test', TEST_PGUSER: env.PGUSER, TEST_PGPASSWORD: env.PGPASSWORD, TEST_PGSSLMODE: 'disable' });
let child: ReturnType<typeof spawn> | undefined, stopping = false;
const stop = () => { stopping = true; child?.kill('SIGTERM'); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  await localCompose(root, env, ['up', '--detach', '--wait', '--wait-timeout', '120', 'postgres', 'auth']);
  const pool = new pg.Pool({ host: env.PGHOST, port: Number(env.PGPORT), user: env.PGUSER, password: env.PGPASSWORD, database: env.PGDATABASE });
  try { await pool.query('CREATE DATABASE little_say_test'); } finally { await pool.end(); }
  if (!stopping) {
    const browser = process.argv.includes('--browser'), allWeb = process.argv.includes('--web');
    const args = browser || allWeb ? [require.resolve('@playwright/test/cli'), 'test', '--config', browser ? 'playwright.accounts.config.ts' : 'playwright.config.ts'] : [fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)), 'run', '--config', 'vitest.integration.config.ts'];
    args.push(...process.argv.slice(2).filter(value => !['--browser', '--web'].includes(value)));
    child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    process.exitCode = await new Promise<number>((done, reject) => { child!.once('error', reject); child!.once('exit', code => done(code ?? 1)); });
  }
} finally {
  await localCompose(root, env, ['down', '--volumes', '--remove-orphans']);
  await rm(media, { recursive: true, force: true });
}
