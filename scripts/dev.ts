/**
 * @file Supervises a worktree's assigned local stack and Expo Go/native client, with shared port claims and owned cleanup.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { apiEnvironment, developmentConfig, developmentHost, developmentOptions, ensureDevelopmentEnv, lanAddresses, loadDevelopmentEnv, withDevelopmentApiKey } from './dev-config';
import { localEnvironment, startLocalServices, checkLocalServices, runningLocalPorts } from './local-services';
import { developmentPortFree, developmentWorkspace, selectDevelopmentPorts, type DevelopmentPortLease } from './dev-ports';
import { developmentExpo } from './dev-expo';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const children: ChildProcess[] = [];
let stopping: Promise<void> | undefined;
let lease: DevelopmentPortLease | undefined;
let dependencies: Promise<void> | undefined;
const cancellation = new AbortController();

async function stop(code: number) {
  if (stopping) return stopping;
  stopping = (async () => {
    cancellation.abort();
    await dependencies?.catch(() => {});
    for (const child of children) {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
      if (process.platform === 'win32') {
        // Node/tsx/Metro have descendants. Only terminate trees started by this launcher.
        await new Promise<void>(resolveStop => {
          const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
          killer.once('error', () => resolveStop()); killer.once('exit', () => resolveStop());
        });
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
        await Promise.race([new Promise<void>(done => child.once('exit', () => done())), delay(2000)]);
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
      }
    }
    await lease?.release();
    process.exitCode = code;
  })();
  return stopping;
}
process.once('SIGINT', () => { void stop(0); });
process.once('SIGTERM', () => { void stop(0); });

async function assertPortFree(port: number, service: string) {
  if (!await developmentPortFree(port)) throw new Error(`${service} port ${port} became unavailable during startup. Restart to select an available port, or change its explicit DEV_*_PORT override. No existing process was stopped.`);
}
async function health(url: string, timeout = 2000) {
  const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(timeout) });
  const data = await response.json() as { status?: string; aiConfigured?: boolean; version?: string };
  if (!response.ok || data.status !== 'ok' || typeof data.aiConfigured !== 'boolean' || !data.version) throw new Error('Not a Little Say API health response.');
  return data;
}
async function waitForApi(url: string) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !stopping) {
    try { return await health(url); } catch { await delay(250); }
  }
  if (stopping) return null;
  throw new Error('The API did not become ready. Check its error above and run npm run dev:doctor.');
}
async function start(label: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, interactive: boolean) {
  if (stopping) return;
  const child = spawn(process.execPath, args, { cwd, env, stdio: [interactive ? 'inherit' : 'ignore', 'inherit', 'inherit'], windowsHide: true, detached: process.platform !== 'win32' });
  children.push(child);
  child.once('error', () => { console.error(`${label} failed to start.`); void stop(1); });
  child.once('exit', (code, signal) => {
    if (!stopping) { console.log(`${label} stopped${signal ? ` (${signal})` : ''}. Stopping this development session.`); void stop(code ?? 1); }
  });
  if (child.pid) await lease?.track(child.pid);
  return child;
}
async function main() {
  const { flags, backend, startApi } = developmentOptions(process.argv.slice(2));
  const remote = backend === 'remote';
  if (flags.has('--help')) {
    console.log('npm run dev / dev:local    Local stack + Expo Go on your LAN\nnpm run dev:native         Local stack + installed Little Say Dev client\nnpm run dev:native -- --remote  Installed client + hosted API\nnpm run dev:remote         Expo Go + hosted API\nnpm run dev:web            Local stack + browser app\nnpm run dev:web:remote     Browser + hosted API\nnpm run dev:server         Local API/worker/dependencies only\nnpm run dev:app            Expo against this worktree’s existing API\nnpm run dev:setup          Create .env without overwriting it\nnpm run dev:doctor         Read saved ports and check connectivity; add -- --remote for hosted\nAdd -- --dev-client to any app launch for the installed client, or -- --clear to clear Metro caches.\nPorts are remembered in .cache/dev/ports.json; claims are shared through the common Git directory.\nDEV_HOST selects a LAN IPv4. DEV_EXPO_PORT, DEV_API_PORT, DEV_PG_PORT and DEV_AUTH_PORT pin exact ports.\nDEV_REMOTE_API_URL overrides https://littlesay.app.');
    return;
  }
  if (!remote && !flags.has('--doctor') && await ensureDevelopmentEnv(root)) console.log('Created .env for optional local settings. The backend can use your AAC_OPENAI_KEY environment variable.');
  const loaded = await loadDevelopmentEnv(root);
  let env = startApi && !flags.has('--doctor') && !flags.has('--setup') ? await withDevelopmentApiKey(loaded) : loaded;
  const addresses = lanAddresses();
  if (flags.has('--doctor')) for (const address of addresses) console.log(`Interface: ${address.name} — ${address.address}`);
  const host = developmentHost(env, addresses);
  const workspace = await developmentWorkspace(root);
  lease = await selectDevelopmentPorts(root, env, { commonDirectory: workspace.commonDirectory, backend,
    mode: flags.has('--doctor') || flags.has('--setup') ? 'inspect' : flags.has('--server-only') ? 'server' : flags.has('--app-only') ? 'app' : 'full',
    containerPorts: () => runningLocalPorts(root, host, remote || flags.has('--app-only')) });
  if (stopping) { await lease.release(); return; }
  env = lease.env;
  const config = developmentConfig(env, addresses, backend);
  console.log(`Worktree: ${root}\nBranch:   ${workspace.branch}\nProject:  ${workspace.project}\nPorts:    Expo ${config.expoPort}${remote ? '' : `, API ${config.apiPort}, PostgreSQL ${config.pgPort}, Auth ${config.authPort}`}\nClient:   ${flags.has('--dev-client') ? 'Little Say Dev (use Expo’s development-client QR code)' : 'Expo Go'}`);
  console.log(`\nLittle Say development (${remote ? 'self-hosted backend' : 'local backend'})\nAPI:      ${config.apiUrl}\nHealth:   ${config.apiUrl}/api/health\n${flags.has('--dev-client') ? `Client server: ${config.webUrl}` : `Expo Go:  ${config.expoUrl}`}\nWeb:      http://localhost:${config.expoPort}\nAPI key:  ${remote ? 'managed on the self-hosted backend; no local key needed' : (env.AAC_OPENAI_KEY || env.OPENAI_API_KEY)?.trim() ? 'configured (backend only)' : 'missing — set AAC_OPENAI_KEY or add OPENAI_API_KEY to .env, then restart'}\n`);
  if (flags.has('--setup')) { console.log('Edit .env, then run npm run dev. Existing values are preserved.'); return; }
  if (flags.has('--doctor')) {
    let apiReady = false;
    for (const url of [config.apiUrl]) {
      try { const data = await health(url, remote ? 10000 : 2000); console.log(`PASS API ${url}: AI ${data.aiConfigured ? 'configured' : 'not configured'}`); apiReady = true; }
      catch { console.log(`FAIL API ${url}: not reachable. ${remote ? 'Check the self-hosted service, network access, and DEV_REMOTE_API_URL.' : 'Start npm run dev; check port and DEV_HOST.'}`); process.exitCode = 1; }
    }
    if (!remote) {
      try {
        await checkLocalServices(localEnvironment(root, env, config.host));
        const worker = await fetch(`${config.apiUrl}/api/development/ready`, { signal: AbortSignal.timeout(3000) });
        if (!worker.ok || !(await worker.json() as { worker?: boolean }).worker) throw new Error('Polling worker is not ready.');
        const auth = await (await fetch(`${config.apiUrl}/api/account/config`, { signal: AbortSignal.timeout(3000) })).json() as { projectId?: string; emulatorUrl?: string };
        if (auth.projectId !== 'demo-little-say' || auth.emulatorUrl !== `http://${config.host}:${config.authPort}`) throw new Error('API Auth settings do not match the selected LAN emulator.');
        console.log('PASS worker readiness and device-facing Auth configuration');
      } catch (error) { console.log(`FAIL local services: ${(error as Error).message}`); process.exitCode = 1; }
    }
    try {
      const response = await fetch(`${config.webUrl}/status`, { signal: AbortSignal.timeout(2000) });
      if (!response.ok || !(await response.text()).includes('packager-status:running')) throw new Error('Not Metro');
      console.log(`PASS Metro ${config.webUrl}`);
      if (remote) { await health(config.webUrl); console.log(`PASS web API proxy ${config.webUrl}/api/health`); }
    } catch { console.log(remote ? 'Metro or its web API proxy is not reachable. Start npm run dev:remote.' : 'Metro is not reachable (expected when running only dev:server).'); if (remote) process.exitCode = 1; }
    if (apiReady) console.log(`On the device, open ${config.apiUrl}/api/health. It should show status: ok. This computer-only check cannot prove device/firewall reachability.`);
    console.log('Use the same trusted LAN. Allow your Expo client local-network access. If needed, see scripts/README.md for the Windows firewall helper. No model calls were made.');
    return;
  }
  const serverOnly = flags.has('--server-only');
  if (startApi) await assertPortFree(config.apiPort, 'API');
  if (!serverOnly) await assertPortFree(config.expoPort, 'Expo');
  if (startApi) {
    const local = localEnvironment(root, apiEnvironment(env, config), config.host);
    console.log('Starting checkout-owned PostgreSQL and Firebase Auth; applying local migrations…');
    dependencies = startLocalServices(root, local, cancellation.signal);
    await dependencies;
    if (stopping) return;
    await assertPortFree(config.apiPort, 'API');
    await start('Worker', [require.resolve('tsx/cli'), 'watch', 'src/worker.ts'], resolve(root, 'apps/server'), local, false);
    await start('API', [require.resolve('tsx/cli'), 'watch', 'src/index.ts'], resolve(root, 'apps/server'), local, false);
  }
  const ready = remote ? await health(config.apiUrl, 10000).catch(() => { throw new Error(`Self-hosted API ${config.apiUrl} is unavailable or did not return Little Say health. Check the deployment/network or DEV_REMOTE_API_URL, then retry. No local backend was started.`); }) : await waitForApi(config.apiUrl);
  if (!ready || stopping) return;
  console.log(`API ready. AI ${ready.aiConfigured ? 'configured' : 'disabled until a key is added'}.`);
  if (serverOnly) { console.log('Run npm run dev:app in a second terminal. Ctrl+C stops the API.'); return; }
  console.log(`Scan the Expo QR code on a device on the same LAN. No server URL entry is needed in the app.\n${remote ? 'Browser API requests use an Expo development proxy. Ctrl+C stops Expo; the self-hosted backend keeps running.' : 'Ctrl+C stops the processes started by this launcher.'}\nStop this session before switching backend modes. Restart after changing .env or networks.\n`);
  await assertPortFree(config.expoPort, 'Expo');
  const expo = developmentExpo(root, config, flags);
  await start('Expo', expo.args, expo.cwd, expo.env, true);
}
main().catch(async error => { console.error(`\n${(error as Error).message}`); await stop(1); });
