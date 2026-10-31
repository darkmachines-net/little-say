/** @file Verifies real concurrent port allocation, restart preferences, overrides, stale ownership and split launcher modes. */
import { afterEach, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile, utimes } from 'node:fs/promises';
import { createServer, type Server, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectDevelopmentPorts, developmentPortFree, type DevelopmentPortLease, type DevelopmentPorts, type PortSelection } from './dev-ports';

const directories: string[] = [], leases: DevelopmentPortLease[] = [], processes: ChildProcess[] = [], sockets: Server[] = [];
afterEach(async () => {
  for (const child of processes.splice(0)) if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
  for (const socket of sockets.splice(0)) await new Promise<void>(done => socket.close(() => done()));
  for (const lease of leases.splice(0)) await lease.release();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'little-say-ports-')); directories.push(base);
  return { base, commonDirectory: join(base, 'common-git'), root: join(base, 'worktree-a'), other: join(base, 'worktree-b') };
}
async function allocate(root: string, commonDirectory: string, env = {}, options: Partial<PortSelection> = {}) {
  const lease = await selectDevelopmentPorts(root, env, { commonDirectory, backend: 'local', mode: 'full', ...options });
  leases.push(lease); return lease;
}
async function listen() {
  const socket = createServer(); sockets.push(socket);
  await new Promise<void>((done, reject) => { socket.once('error', reject); socket.listen(0, '0.0.0.0', done); });
  return (socket.address() as AddressInfo).port;
}
async function launch(root: string, commonDirectory: string) {
  const child = fork(fileURLToPath(new URL('./fixtures/dev-port-client.ts', import.meta.url)), [root, commonDirectory], {
    execArgv: ['--import', 'tsx'], windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  processes.push(child);
  const ports = await new Promise<DevelopmentPorts>((done, reject) => {
    child.once('message', value => done(value as DevelopmentPorts)); child.once('error', reject);
    child.once('exit', code => reject(new Error(`Allocator exited before readiness: ${code}`)));
    child.stderr?.on('data', value => reject(new Error(String(value))));
  });
  return { child, ports };
}

it('coordinates simultaneous independent processes and releases killed owners on the next allocation', async () => {
  const { root, other, commonDirectory } = await fixture();
  const [a, b] = await Promise.all([launch(root, commonDirectory), launch(other, commonDirectory)]);
  expect(new Set([...Object.values(a.ports), ...Object.values(b.ports)]).size).toBe(8);
  const ended = once(a.child, 'exit'); a.child.kill(); await ended;
  const restarted = await allocate(root, commonDirectory);
  expect(restarted.ports).toEqual(a.ports);
  await expect(allocate(other, commonDirectory)).rejects.toThrow('already has a running');
}, 20000);

it('remembers available ports across restarts and keeps cleanup scoped to the owning session', async () => {
  const { root, other, commonDirectory } = await fixture();
  const a = await allocate(root, commonDirectory), b = await allocate(other, commonDirectory);
  await a.release();
  const again = await allocate(root, commonDirectory);
  expect(again.ports).toEqual(a.ports);
  await expect(allocate(other, commonDirectory)).rejects.toThrow('already has a running');
  const claims = JSON.parse(await readFile(join(commonDirectory, 'little-say-dev/claims.json'), 'utf8'));
  expect(claims).toHaveLength(2); expect(claims.some((claim: any) => claim.ports.expo === b.ports.expo)).toBe(true);
});

it('skips occupied remembered ports but treats explicit overrides as hard requirements', async () => {
  const { root, commonDirectory } = await fixture(), busy = await listen();
  await mkdir(join(root, '.cache/dev'), { recursive: true });
  await writeFile(join(root, '.cache/dev/ports.json'), JSON.stringify({ version: 1, ports: { expo: busy } }));
  await expect(allocate(root, commonDirectory, { DEV_EXPO_PORT: String(busy) })).rejects.toThrow('DEV_EXPO_PORT');
  expect(await developmentPortFree(busy)).toBe(false);
  const automatic = await allocate(root, commonDirectory);
  expect(automatic.ports.expo).not.toBe(busy);
});

it('validates all local ports and allocates around explicit choices across different services', async () => {
  const { root, commonDirectory } = await fixture();
  for (const key of ['DEV_PG_PORT', 'DEV_AUTH_PORT', 'DEV_EXPO_PORT', 'DEV_API_PORT']) {
    await expect(allocate(root, commonDirectory, { [key]: '9000oops' })).rejects.toThrow('between');
  }
  await expect(allocate(root, commonDirectory, { DEV_AUTH_PORT: '12000', DEV_PG_PORT: '12000' })).rejects.toThrow('different');
  const available = await listen(), socket = sockets.pop()!;
  await new Promise<void>(done => socket.close(() => done()));
  await mkdir(join(root, '.cache/dev'), { recursive: true });
  await writeFile(join(root, '.cache/dev/ports.json'), JSON.stringify({ version: 1, ports: { expo: available } }));
  const allocation = await allocate(root, commonDirectory, { DEV_AUTH_PORT: String(available) });
  expect(allocation.ports.auth).toBe(available); expect(allocation.ports.expo).not.toBe(available);
});

it('reuses only inspected checkout-owned dependency listeners', async () => {
  const { root, commonDirectory } = await fixture(), postgres = await listen(), auth = await listen();
  const allocation = await allocate(root, commonDirectory, {}, { containerPorts: async () => ({ owned: { postgres, auth }, occupied: [postgres, auth] }) });
  expect(allocation.ports).toMatchObject({ postgres, auth });
  expect(allocation.env.PGPORT).toBeUndefined();
  expect(allocation.env.DEV_PG_PORT).toBe(String(postgres));
});

it('avoids Docker-published ports even when the host kernel reports them free', async () => {
  const { root, commonDirectory } = await fixture();
  const occupied = await listen(), socket = sockets.pop()!;
  await new Promise<void>(done => socket.close(() => done()));
  const containerPorts = async () => ({ owned: {}, occupied: [occupied] });
  await expect(allocate(root, commonDirectory, { DEV_PG_PORT: String(occupied) }, { containerPorts })).rejects.toThrow('DEV_PG_PORT');
  await mkdir(join(root, '.cache/dev'), { recursive: true });
  await writeFile(join(root, '.cache/dev/ports.json'), JSON.stringify({ version: 1, ports: { postgres: occupied } }));
  const allocation = await allocate(root, commonDirectory, {}, { containerPorts });
  expect(allocation.ports.postgres).not.toBe(occupied);
});

it('attaches app-only to the saved server while keeping the two process claims independent', async () => {
  const { root, commonDirectory } = await fixture();
  const server = await allocate(root, commonDirectory, {}, { mode: 'server' });
  await expect(allocate(root, commonDirectory, { DEV_API_PORT: String(server.ports.api + 20) }, { mode: 'app' })).rejects.toThrow('existing backend');
  const app = await allocate(root, commonDirectory, {}, { mode: 'app' });
  expect(app.ports).toEqual(server.ports);
  await server.release();
  await expect(allocate(root, commonDirectory, { DEV_API_PORT: String(server.ports.api + 20) }, { mode: 'server' })).rejects.toThrow('Stop this worktree');
  const restarted = await allocate(root, commonDirectory, {}, { mode: 'server' });
  expect(restarted.ports).toEqual(server.ports);
});

it.each(['127.0.0.1', '::1'])('detects listeners bound specifically to %s', async host => {
  const socket = createServer(); sockets.push(socket);
  await new Promise<void>((done, reject) => { socket.once('error', reject); socket.listen({ port: 0, host, ipv6Only: host === '::1' }, done); });
  expect(await developmentPortFree((socket.address() as AddressInfo).port)).toBe(false);
});

it('retains a claim if an owned child survives a killed launcher, even after the worktree is deleted', async () => {
  const { root, other, commonDirectory } = await fixture();
  const fixtureProcess = await launch(other, commonDirectory);
  const deadPid = fixtureProcess.child.pid!;
  const ended = once(fixtureProcess.child, 'exit'); fixtureProcess.child.kill(); await ended;
  const lease = await allocate(root, commonDirectory); await lease.track(process.pid);
  const registry = join(commonDirectory, 'little-say-dev/claims.json');
  const claims = JSON.parse(await readFile(registry, 'utf8'));
  claims[0].pid = deadPid;
  await writeFile(registry, JSON.stringify(claims));
  await rm(root, { recursive: true, force: true });
  await expect(allocate(root, commonDirectory)).rejects.toThrow('already has a running');
  await lease.release();
  const fresh = await allocate(root, commonDirectory);
  expect(fresh.ports.expo).toBeGreaterThan(1023);
});

it('allocates only Metro for remote sessions and leaves local choices intact', async () => {
  const { root, commonDirectory } = await fixture();
  const local = await allocate(root, commonDirectory); await local.release();
  const remote = await allocate(root, commonDirectory, { DEV_API_PORT: 'invalid', DEV_PG_PORT: '-1', DEV_AUTH_PORT: 'bad' }, { backend: 'remote' });
  const claims = JSON.parse(await readFile(join(commonDirectory, 'little-say-dev/claims.json'), 'utf8'));
  expect(Object.keys(claims[0].ports)).toEqual(['expo']);
  expect(remote.ports).toEqual(local.ports);
});

it('inspects existing or default preferences without writing or claiming ports', async () => {
  const { root, commonDirectory } = await fixture();
  await allocate(root, commonDirectory, {}, { mode: 'inspect' });
  await expect(readFile(join(root, '.cache/dev/ports.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(join(commonDirectory, 'little-say-dev/claims.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  const active = await allocate(root, commonDirectory);
  const before = await readFile(join(root, '.cache/dev/ports.json'), 'utf8');
  const inspection = await allocate(root, commonDirectory, {}, { mode: 'inspect' });
  expect(inspection.ports).toEqual(active.ports);
  expect(await readFile(join(root, '.cache/dev/ports.json'), 'utf8')).toBe(before);
});

it('recovers a crashed allocation lock without clearing saved preferences or live claims', async () => {
  const { root, commonDirectory } = await fixture();
  const lock = join(commonDirectory, 'little-say-dev/claims.json.lock');
  await mkdir(lock, { recursive: true });
  const expired = new Date(Date.now() - 20000); await utimes(lock, expired, expired);
  const result = await allocate(root, commonDirectory);
  expect(result.ports.expo).toBeGreaterThan(1023);
});
