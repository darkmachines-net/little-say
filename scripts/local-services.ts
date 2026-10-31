/** @file Inspects and starts checkout-owned PostgreSQL/Auth dependencies with resolved ports and persistent data. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createDatabase, checkDatabase } from '../apps/server/src/database';
import { developmentProject, type DevelopmentPorts } from './dev-ports';
const execute = promisify(execFile);
const require = createRequire(import.meta.url);

/** Derive local-only settings; no inherited hosted database or authentication credentials reach these services. */
export function localEnvironment(root: string, env: NodeJS.ProcessEnv, host = '127.0.0.1', project?: string): NodeJS.ProcessEnv {
  return { ...env, NODE_ENV: 'development',
    COMPOSE_PROJECT_NAME: project ?? developmentProject(root),
    DEV_PG_PORT: env.DEV_PG_PORT || '15432', DEV_AUTH_PORT: env.DEV_AUTH_PORT || '9099', DEV_AUTH_BIND: host,
    PGHOST: '127.0.0.1', PGPORT: env.DEV_PG_PORT || '15432', PGDATABASE: 'little_say', PGUSER: 'little_say', PGPASSWORD: 'local-development-only', PGSSLMODE: 'disable', PGOPTIONS: '',
    FIREBASE_PROJECT_ID: 'demo-little-say', FIREBASE_AUTH_EMULATOR_HOST: `${host}:${env.DEV_AUTH_PORT || '9099'}`, FIREBASE_AUTH_EMULATOR_URL: `http://${host}:${env.DEV_AUTH_PORT || '9099'}`,
    FIREBASE_API_KEY: 'demo-key', FIREBASE_APP_ID: 'demo-app', FIREBASE_AUTH_DOMAIN: 'demo-little-say.firebaseapp.com', FIREBASE_AUTH_PROVIDERS: 'password',
    MEDIA_BUCKET: '', MEDIA_DIRECTORY: resolve(root, '.cache/media'), TASKS_QUEUE: '', WORKER_MODE: 'poll', WORKER_URL: '', TASKS_INVOKER: '',
  };
}

/**
 * Read published TCP bindings without inspecting container secrets. Docker Desktop can reserve ports
 * that pass a host socket probe; only this checkout's matching dependency bindings may be reused.
 * Optional mode permits remote/app-only development on hosts without a reachable Docker daemon.
 */
export async function runningLocalPorts(root: string, host: string, optional = false): Promise<{ owned: Partial<DevelopmentPorts>; occupied: number[] }> {
  const options = { cwd: root, windowsHide: true, timeout: 10000 };
  const project = developmentProject(root);
  let stdout: string;
  try { ({ stdout } = await execute('docker', ['ps', '--format', '{{.ID}}'], options)); }
  catch (error) { if (optional) return { owned: {}, occupied: [] }; throw error; }
  const ids = stdout.trim().split(/\s+/).filter(Boolean);
  if (!ids.length) return { owned: {}, occupied: [] };
  const format = '{"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"ports":{{json .NetworkSettings.Ports}}}';
  const inspected = await execute('docker', ['inspect', '--format', format, ...ids], options);
  const containers = inspected.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line)) as { project: string; service: string; ports: Record<string, { HostIp: string; HostPort: string }[] | null> }[];
  const ports: Partial<DevelopmentPorts> = {};
  const occupied: number[] = [];
  for (const container of containers) {
    for (const [internal, bindings] of Object.entries(container.ports ?? {})) if (internal.endsWith('/tcp')) {
      occupied.push(...(bindings ?? []).map(binding => Number(binding.HostPort)));
    }
    if (container.project !== project) continue;
    const service = container.service;
    if (service !== 'postgres' && service !== 'auth') continue;
    const binding = container.ports[service === 'postgres' ? '5432/tcp' : '9099/tcp']
      ?.find(value => value.HostIp === (service === 'postgres' ? '127.0.0.1' : host));
    if (binding) ports[service] = Number(binding.HostPort);
  }
  return { owned: ports, occupied };
}

/** Run Compose for the named checkout/test project; cancellation stops the CLI but preserves its persistent containers. */
export async function localCompose(root: string, env: NodeJS.ProcessEnv, args: string[], signal?: AbortSignal) {
  if (!/^little-say-[a-z0-9-]+$/.test(env.COMPOSE_PROJECT_NAME || '')) throw new Error('A checkout-owned Compose project is required.');
  try {
    const result = await execute('docker', ['compose', '--project-name', env.COMPOSE_PROJECT_NAME!, '--file', resolve(root, 'compose.yaml'), ...args], { cwd: root, env, signal, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    if (result.stdout.trim()) console.log(result.stdout.trim());
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new Error(`Local services failed. Check Docker and DEV_PG_PORT/DEV_AUTH_PORT; no unrelated process was stopped.\n${failure.stderr?.slice(-4000) || failure.message}`, { cause: error });
  }
}

/** Start persistent dependencies and migrate the selected database; cancellation stops pending commands without deleting data. */
export async function startLocalServices(root: string, env: NodeJS.ProcessEnv, signal?: AbortSignal) {
  await localCompose(root, env, ['up', '--detach', '--wait', '--wait-timeout', '120', 'postgres', 'auth'], signal);
  await execute(process.execPath, [require.resolve('tsx/cli'), resolve(root, 'apps/server/src/database-cli.ts'), 'migrate'], { cwd: root, env, signal, windowsHide: true, maxBuffer: 1024 * 1024 });
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
