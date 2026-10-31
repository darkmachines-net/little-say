/** @file Coordinates worktree port claims in common Git metadata and remembers checkout-local port preferences. */
import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import lockfile from 'proper-lockfile';

const execute = promisify(execFile);
const defaults = { expo: 8081, api: 8788, postgres: 15432, auth: 9099 };
const variables = { expo: 'DEV_EXPO_PORT', api: 'DEV_API_PORT', postgres: 'DEV_PG_PORT', auth: 'DEV_AUTH_PORT' };
export type DevelopmentPort = keyof typeof defaults;
export type DevelopmentPorts = Record<DevelopmentPort, number>;
type Claim = { id: string; root: string; pid: number; children: number[]; ports: Partial<DevelopmentPorts> };
type Saved = { version: 1; ports: Partial<DevelopmentPorts> };
export interface PortSelection {
  commonDirectory: string;
  backend: 'local' | 'remote';
  mode: 'full' | 'server' | 'app' | 'inspect';
  /** Inspect Docker reservations, including checkout-owned bindings that can be reused. */
  containerPorts?: () => Promise<{ owned: Partial<DevelopmentPorts>; occupied: number[] }>;
}
export interface DevelopmentPortLease {
  ports: DevelopmentPorts;
  env: NodeJS.ProcessEnv;
  /** Retain the claim while an owned child survives an abrupt launcher exit. */
  track(pid: number): Promise<void>;
  /** Remove only this launcher's claim after stopping its children; remembered choices remain. */
  release(): Promise<void>;
}

/** Preserve the existing checkout-derived Compose identity so port changes never replace durable data. */
export function developmentProject(root: string): string {
  return 'little-say-' + createHash('sha256').update(resolve(root).toLowerCase()).digest('hex').slice(0, 10);
}

/** Locate shared Git metadata from any worktree and report its branch or detached commit for the terminal. */
export async function developmentWorkspace(root: string) {
  const options = { cwd: root, windowsHide: true };
  const { stdout } = await execute('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], options);
  const branch = await execute('git', ['symbolic-ref', '--short', 'HEAD'], options)
    .catch(() => execute('git', ['rev-parse', '--short', 'HEAD'], options));
  return { commonDirectory: resolve(stdout.trim()), branch: branch.stdout.trim(), project: developmentProject(root) };
}

/** Validate explicit TCP ports without accepting numeric prefixes, privileged ports or out-of-range values. */
export function developmentPort(value: string | undefined, fallback: number, name: string): number {
  if (!value?.trim()) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new Error(`${name} must be a port between 1024 and 65535.`);
  return Number(value);
}

/**
 * Probe wildcard and concrete local interfaces: Windows can accept a wildcard bind beside an occupied
 * specific-address listener. Close each probe before returning and never terminate an existing owner.
 */
export async function developmentPortFree(port: number): Promise<boolean> {
  const interfaces = Object.values(networkInterfaces()).flatMap(entries => entries ?? []).map(entry => entry.address)
    .filter(address => !address.toLowerCase().startsWith('fe80:'));
  for (const host of new Set(['0.0.0.0', '127.0.0.1', '::', '::1', ...interfaces])) {
    const free = await new Promise<boolean>((done, reject) => {
      const socket = createServer();
      socket.once('error', (error: NodeJS.ErrnoException) => {
        if (['EADDRINUSE', 'EACCES'].includes(error.code || '')) done(false);
        else if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code || '')) done(true);
        else reject(error);
      });
      socket.listen({ port, host, ipv6Only: host.includes(':') }, () => socket.close(error => error ? reject(error) : done(true)));
    });
    if (!free) return false;
  }
  return true;
}

function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw new Error(`Cannot read development state ${file}.`, { cause: error }); }
}
async function writeJson(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n'); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
async function savedPorts(file: string) {
  const saved = await readJson<Saved>(file, { version: 1, ports: {} });
  if (saved.version !== 1 || !saved.ports || Object.entries(saved.ports).some(([key, value]) => !(key in defaults) || !Number.isInteger(value) || value < 1024 || value > 65535)) {
    throw new Error(`Invalid port preferences in ${file}; remove that file to choose ports again.`);
  }
  return saved.ports;
}
async function claimsFrom(file: string) {
  const claims = await readJson<Claim[]>(file, []);
  if (!Array.isArray(claims) || claims.some(claim => !claim.id || !claim.root || !Number.isInteger(claim.pid) || claim.pid <= 0 || !Array.isArray(claim.children) || !claim.ports)) {
    throw new Error(`Invalid development claims in ${file}.`);
  }
  return claims.filter(claim => [claim.pid, ...claim.children].some(alive));
}
async function locked<T>(file: string, work: () => Promise<T>) {
  await mkdir(dirname(file), { recursive: true });
  const unlock = await lockfile.lock(file, { realpath: false, stale: 10000, update: 2000,
    retries: { retries: 100, minTimeout: 150, maxTimeout: 150, factor: 1 } });
  try { return await work(); } finally { await unlock(); }
}

/**
 * Resolve exact overrides or available remembered/default ports under a lock shared by all Git worktrees.
 * Claims cover only launched services, allowing server/app split sessions. Inspect mode never writes state.
 * Dead launchers/children are pruned on the next mutation; socket probes still protect surviving listeners.
 */
export async function selectDevelopmentPorts(root: string, env: NodeJS.ProcessEnv, selection: PortSelection): Promise<DevelopmentPortLease> {
  const cache = resolve(root, '.cache/dev/ports.json');
  const registry = resolve(selection.commonDirectory, 'little-say-dev/claims.json');
  const id = randomUUID(), owner = process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root), remote = selection.backend === 'remote';
  const active: DevelopmentPort[] = remote ? ['expo'] : ['expo', 'api', 'postgres', 'auth'];
  const requested = active.filter(key => selection.mode === 'server' ? key !== 'expo' : selection.mode === 'app' ? key === 'expo' : true);
  const explicit = Object.fromEntries(active.filter(key => env[variables[key]]?.trim()).map(key => [key, developmentPort(env[variables[key]], defaults[key], variables[key])])) as Partial<DevelopmentPorts>;
  if (new Set(Object.values(explicit)).size !== Object.values(explicit).length) throw new Error('Development service ports must be different.');

  const resolvePorts = async () => {
    const saved = await savedPorts(cache);
    const ports: DevelopmentPorts = { ...defaults, ...saved, ...explicit };
    if (selection.mode === 'inspect') return ports;
    const claims = await claimsFrom(registry);
    const same = claims.filter(claim => claim.root === owner);
    for (const key of requested) if (same.some(claim => claim.ports[key] !== undefined)) {
      throw new Error(`This worktree already has a running ${key} launcher or child. Stop that session before starting it again.`);
    }
    if (selection.mode === 'app' && !remote) {
      for (const key of ['api', 'postgres', 'auth'] as const) {
        const running = same.find(claim => claim.ports[key] !== undefined)?.ports[key];
        const existing = running ?? saved[key];
        if (existing !== undefined && explicit[key] !== undefined && explicit[key] !== existing) throw new Error(`${variables[key]} differs from this worktree's existing backend. Restart dev:server first.`);
        ports[key] = existing ?? ports[key];
      }
    }
    const containers = await selection.containerPorts?.() ?? { owned: {}, occupied: [] };
    const owned = !remote && selection.mode !== 'app' ? containers.owned : {};
    const dockerPorts = new Set(containers.occupied);
    const used = new Set(claims.flatMap(claim => Object.values(claim.ports)));
    // Explicit values take priority over automatic candidates regardless of selection order.
    const taken = new Set(Object.values(explicit));
    for (const key of active.filter(key => !requested.includes(key))) taken.add(ports[key]);
    for (const key of requested) {
      const preferred = explicit[key] ?? owned[key] ?? saved[key] ?? defaults[key];
      let candidate = preferred;
      for (let attempts = 0; ; attempts++, candidate = candidate === 65535 ? 1024 : candidate + 1) {
        if (attempts >= 64512) throw new Error(`No available development port for ${key}.`);
        const occupied = used.has(candidate) || (candidate !== explicit[key] && taken.has(candidate));
        if (!occupied && (candidate === owned[key] || !dockerPorts.has(candidate) && await developmentPortFree(candidate))) break;
        if (explicit[key] !== undefined) throw new Error(`${variables[key]}=${candidate} is unavailable. Choose an unused port or remove the override for automatic selection. No existing process was stopped.`);
      }
      ports[key] = candidate; taken.add(candidate); used.add(candidate);
      if (selection.mode === 'server' && same.some(claim => claim.ports.expo !== undefined) && saved[key] !== undefined && saved[key] !== candidate) {
        throw new Error(`Stop this worktree's app launcher before changing its ${key} port.`);
      }
    }
    // Server-only reserves no Expo process, but preserves a distinct preferred port for dev:app.
    if (selection.mode === 'server' && new Set(active.map(key => ports[key])).size !== active.length) {
      if (explicit.expo) throw new Error('Development service ports must be different.');
      while (active.some(key => key !== 'expo' && ports[key] === ports.expo)) ports.expo = ports.expo === 65535 ? 1024 : ports.expo + 1;
    }
    const claimed = Object.fromEntries(requested.map(key => [key, ports[key]]));
    claims.push({ id, root: owner, pid: process.pid, children: [], ports: claimed });
    await writeJson(cache, { version: 1, ports: { ...saved, ...Object.fromEntries(active.map(key => [key, ports[key]])) } });
    await writeJson(registry, claims);
    return ports;
  };
  const ports = selection.mode === 'inspect' ? await resolvePorts() : await locked(registry, resolvePorts);
  let released = selection.mode === 'inspect';
  return { ports, env: { ...env, ...Object.fromEntries(active.map(key => [variables[key], String(ports[key])])) },
    /** Record a child PID while holding the shared allocation lock. */
    async track(pid) {
      if (released) return;
      await locked(registry, async () => {
        const claims = await claimsFrom(registry), claim = claims.find(item => item.id === id);
        if (!claim) throw new Error('This development session lost its port claim.');
        claim.children.push(pid); await writeJson(registry, claims);
      });
    },
    /** Release this session's claims without deleting preferences or persistent Docker data. */
    async release() {
      if (released) return;
      await locked(registry, async () => { await writeJson(registry, (await claimsFrom(registry)).filter(claim => claim.id !== id)); });
      released = true;
    },
  };
}
