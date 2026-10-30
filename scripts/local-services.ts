/** @file Starts checkout-owned local PostgreSQL/Auth dependencies and prepares the shared runtime environment. */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createDatabase, checkDatabase } from '../apps/server/src/database';
const execute = promisify(execFile);
const require = createRequire(import.meta.url);

/** Derive local-only settings; no inherited hosted database or authentication credentials reach these services. */
export function localEnvironment(root: string, env: NodeJS.ProcessEnv, host = '127.0.0.1', project?: string): NodeJS.ProcessEnv {
  return { ...env, NODE_ENV: 'development',
    COMPOSE_PROJECT_NAME: project ?? 'little-say-' + createHash('sha256').update(resolve(root).toLowerCase()).digest('hex').slice(0, 10),
    DEV_PG_PORT: env.DEV_PG_PORT || '15432', DEV_AUTH_PORT: env.DEV_AUTH_PORT || '9099', DEV_AUTH_BIND: host,
    PGHOST: '127.0.0.1', PGPORT: env.DEV_PG_PORT || '15432', PGDATABASE: 'little_say', PGUSER: 'little_say', PGPASSWORD: 'local-development-only', PGSSLMODE: 'disable', PGOPTIONS: '',
    FIREBASE_PROJECT_ID: 'demo-little-say', FIREBASE_AUTH_EMULATOR_HOST: `${host}:${env.DEV_AUTH_PORT || '9099'}`, FIREBASE_AUTH_EMULATOR_URL: `http://${host}:${env.DEV_AUTH_PORT || '9099'}`,
    FIREBASE_API_KEY: 'demo-key', FIREBASE_APP_ID: 'demo-app', FIREBASE_AUTH_DOMAIN: 'demo-little-say.firebaseapp.com', FIREBASE_AUTH_PROVIDERS: 'password',
    MEDIA_BUCKET: '', MEDIA_DIRECTORY: resolve(root, '.cache/media'), TASKS_QUEUE: '', WORKER_MODE: 'poll', WORKER_URL: '', TASKS_INVOKER: '',
  };
}

/** Run Compose only for the explicitly named checkout/test project; report sanitized diagnostics on failure. */
export async function localCompose(root: string, env: NodeJS.ProcessEnv, args: string[]) {
  if (!/^little-say-[a-z0-9-]+$/.test(env.COMPOSE_PROJECT_NAME || '')) throw new Error('A checkout-owned Compose project is required.');
  try {
    const result = await execute('docker', ['compose', '--project-name', env.COMPOSE_PROJECT_NAME!, '--file', resolve(root, 'compose.yaml'), ...args], { cwd: root, env, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    if (result.stdout.trim()) console.log(result.stdout.trim());
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new Error(`Local services failed. Check Docker and DEV_PG_PORT/DEV_AUTH_PORT; no unrelated process was stopped.\n${failure.stderr?.slice(-4000) || failure.message}`, { cause: error });
  }
}

/** Start persistent dependencies, await readiness, and migrate the selected local database before application startup. */
export async function startLocalServices(root: string, env: NodeJS.ProcessEnv) {
  await localCompose(root, env, ['up', '--detach', '--wait', '--wait-timeout', '120', 'postgres', 'auth']);
  await execute(process.execPath, [require.resolve('tsx/cli'), resolve(root, 'apps/server/src/database-cli.ts'), 'migrate'], { cwd: root, env, windowsHide: true, maxBuffer: 1024 * 1024 });
}

/** Inspect local migration state and Auth availability without starting dependencies or calling AI. */
export async function checkLocalServices(env: NodeJS.ProcessEnv) {
  const pool = createDatabase(env);
  try { await checkDatabase(pool); console.log(`PASS PostgreSQL: loopback ${env.PGHOST}:${env.PGPORT}; migrations current`); }
  finally { await pool.end(); }
  const response = await fetch(`${env.FIREBASE_AUTH_EMULATOR_URL}/emulator/v1/projects/demo-little-say/oobCodes`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('The checkout Auth emulator is unavailable.');
  console.log(`PASS Firebase Auth emulator: ${env.FIREBASE_AUTH_EMULATOR_URL}`);
}
