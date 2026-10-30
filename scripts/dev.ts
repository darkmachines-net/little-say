/**
 * @file Launches the local database/Auth/API/worker stack or hosted API with Expo, isolated credentials, and owned cleanup.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { apiEnvironment, developmentConfig, developmentOptions, ensureDevelopmentEnv, expoEnvironment, lanAddresses, loadDevelopmentEnv, withDevelopmentApiKey } from './dev-config';
import { localEnvironment, startLocalServices, checkLocalServices } from './local-services';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const children: ChildProcess[] = [];
let stopping: Promise<void> | undefined;

async function stop(code: number) {
  if (stopping) return stopping;
  stopping = (async () => {
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
    process.exitCode = code;
  })();
  return stopping;
}
process.once('SIGINT', () => { void stop(0); });
process.once('SIGTERM', () => { void stop(0); });

async function assertPortFree(port: number, service: string) {
  await new Promise<void>((done, reject) => {
    const socket = createServer();
    socket.once('error', () => reject(new Error(`${service} port ${port} is unavailable. Stop its current owner or change ${service === 'API' ? 'DEV_API_PORT' : 'DEV_EXPO_PORT'} in .env. No existing process was stopped.`)));
    socket.listen(port, '0.0.0.0', () => socket.close(error => error ? reject(error) : done()));
  });
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
function start(label: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, interactive: boolean) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: [interactive ? 'inherit' : 'ignore', 'inherit', 'inherit'], windowsHide: true, detached: process.platform !== 'win32' });
  children.push(child);
  child.once('error', () => { console.error(`${label} failed to start.`); void stop(1); });
  child.once('exit', (code, signal) => {
    if (!stopping) { console.log(`${label} stopped${signal ? ` (${signal})` : ''}. Stopping this development session.`); void stop(code ?? 1); }
  });
  return child;
}
async function main() {
  const { flags, backend, startApi } = developmentOptions(process.argv.slice(2));
  const remote = backend === 'remote';
  if (flags.has('--help')) {
    console.log('npm run dev / dev:local    Local API + Expo Go on your LAN\nnpm run dev:remote         Expo Go + self-hosted API (no local backend/key needed)\nnpm run dev:web            Local API + Expo browser app\nnpm run dev:web:remote     Expo browser app + self-hosted API through a local proxy\nnpm run dev:server         Local API only\nnpm run dev:app            Expo Go only (local API must already be running)\nnpm run dev:setup          Create .env without overwriting it\nnpm run dev:doctor         Check local API/Metro connectivity; add -- --remote for self-hosted\nAppend -- --clear to clear Metro caches. Set DEV_HOST and DEV_EXPO_PORT in .env to override detection.\nDEV_API_PORT selects the local API port. DEV_REMOTE_API_URL overrides https://littlesay.app.');
    return;
  }
  if (!remote && await ensureDevelopmentEnv(root)) console.log('Created .env for optional local settings. The backend can use your AAC_OPENAI_KEY environment variable.');
  const loaded = await loadDevelopmentEnv(root);
  const env = startApi && !flags.has('--doctor') && !flags.has('--setup') ? await withDevelopmentApiKey(loaded) : loaded;
  const addresses = lanAddresses();
  if (flags.has('--doctor')) for (const address of addresses) console.log(`Interface: ${address.name} — ${address.address}`);
  const config = developmentConfig(env, addresses, backend);
  console.log(`\nLittle Say development (${remote ? 'self-hosted backend' : 'local backend'})\nAPI:      ${config.apiUrl}\nHealth:   ${config.apiUrl}/api/health\nExpo Go:  ${config.expoUrl}\nWeb:      http://localhost:${config.expoPort}\nAPI key:  ${remote ? 'managed on the self-hosted backend; no local key needed' : (env.AAC_OPENAI_KEY || env.OPENAI_API_KEY)?.trim() ? 'configured (backend only)' : 'missing — set AAC_OPENAI_KEY or add OPENAI_API_KEY to .env, then restart'}\n`);
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
        if (auth.projectId !== 'demo-little-say' || auth.emulatorUrl !== `http://${config.host}:${env.DEV_AUTH_PORT || '9099'}`) throw new Error('API Auth settings do not match the selected LAN emulator.');
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
    console.log('Use the same trusted LAN. Allow Expo Go local-network access. If needed, see scripts/README.md for the Windows firewall helper. No model calls were made.');
    return;
  }
  const serverOnly = flags.has('--server-only');
  if (startApi) await assertPortFree(config.apiPort, 'API');
  if (!serverOnly) await assertPortFree(config.expoPort, 'Expo');
  if (startApi) {
    const local = localEnvironment(root, apiEnvironment(env, config), config.host);
    console.log('Starting checkout-owned PostgreSQL and Firebase Auth; applying local migrations…');
    await startLocalServices(root, local);
    start('Worker', [require.resolve('tsx/cli'), 'watch', 'src/worker.ts'], resolve(root, 'apps/server'), local, false);
    start('API', [require.resolve('tsx/cli'), 'watch', 'src/index.ts'], resolve(root, 'apps/server'), local, false);
  }
  const ready = remote ? await health(config.apiUrl, 10000).catch(() => { throw new Error(`Self-hosted API ${config.apiUrl} is unavailable or did not return Little Say health. Check the deployment/network or DEV_REMOTE_API_URL, then retry. No local backend was started.`); }) : await waitForApi(config.apiUrl);
  if (!ready || stopping) return;
  console.log(`API ready. AI ${ready.aiConfigured ? 'configured' : 'disabled until a key is added'}.`);
  if (serverOnly) { console.log('Run npm run dev:app in a second terminal. Ctrl+C stops the API.'); return; }
  console.log(`Scan the Expo QR code on a device on the same LAN. No server URL entry is needed in the app.\n${remote ? 'Browser API requests use an Expo development proxy. Ctrl+C stops Expo; the self-hosted backend keeps running.' : 'Ctrl+C stops the processes started by this launcher.'}\nStop this session before switching backend modes. Restart after changing .env or networks.\n`);
  start('Expo', [require.resolve('expo/bin/cli'), 'start', '--go', '--lan', '--port', String(config.expoPort), ...(flags.has('--web') ? ['--web'] : []), ...(flags.has('--clear') ? ['--clear'] : [])], resolve(root, 'apps/mobile'), expoEnvironment(process.env, config), true);
}
main().catch(async error => { console.error(`\n${(error as Error).message}`); await stop(1); });
