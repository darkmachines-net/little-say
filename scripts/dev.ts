import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { apiEnvironment, developmentConfig, ensureDevelopmentEnv, expoEnvironment, lanAddresses, loadDevelopmentEnv, withDevelopmentApiKey } from './dev-config';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const flags = new Set(process.argv.slice(2));
const supported = ['--web', '--server-only', '--app-only', '--setup', '--doctor', '--clear', '--help'];
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
async function health(url: string) {
  const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
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
  const unknown = [...flags].filter(flag => !supported.includes(flag));
  if (unknown.length) throw new Error(`Unknown option: ${unknown.join(', ')}. Use npm run dev -- --help.`);
  if (flags.has('--help')) {
    console.log('npm run dev [-- --clear]   API + Expo Go on your LAN\nnpm run dev:web            API + Expo browser app\nnpm run dev:server         API only\nnpm run dev:app            Expo Go only (API must already be running)\nnpm run dev:setup          Create .env without overwriting it\nnpm run dev:doctor         List addresses and check API/Metro connectivity\nSet DEV_HOST, DEV_API_PORT, DEV_EXPO_PORT in .env to override detection.');
    return;
  }
  if (['--server-only', '--app-only', '--setup', '--doctor'].filter(flag => flags.has(flag)).length > 1) throw new Error('Choose one launch mode.');
  if (await ensureDevelopmentEnv(root)) console.log('Created .env for optional local settings. The backend can use your AAC_OPENAI_KEY environment variable.');
  const env = await withDevelopmentApiKey(await loadDevelopmentEnv(root));
  const addresses = lanAddresses();
  if (flags.has('--doctor')) for (const address of addresses) console.log(`Interface: ${address.name} — ${address.address}`);
  const config = developmentConfig(env, addresses);
  console.log(`\nLittle Say local development\nAPI:      ${config.apiUrl}\nHealth:   ${config.apiUrl}/api/health\nExpo Go:  ${config.expoUrl}\nWeb:      http://localhost:${config.expoPort}\nAPI key:  ${(env.AAC_OPENAI_KEY || env.OPENAI_API_KEY)?.trim() ? 'configured (backend only)' : 'missing — set AAC_OPENAI_KEY or add OPENAI_API_KEY to .env, then restart'}\n`);
  if (flags.has('--setup')) { console.log('Edit .env, then run npm run dev. Existing values are preserved.'); return; }
  if (flags.has('--doctor')) {
    let apiReady = false;
    for (const url of [`http://127.0.0.1:${config.apiPort}`, config.apiUrl]) {
      try { const data = await health(url); console.log(`PASS API ${url}: AI ${data.aiConfigured ? 'configured' : 'not configured'}`); apiReady = true; }
      catch { console.log(`FAIL API ${url}: not reachable. Start npm run dev; check port and DEV_HOST.`); process.exitCode = 1; }
    }
    try {
      const response = await fetch(`${config.webUrl}/status`, { signal: AbortSignal.timeout(2000) });
      if (!response.ok || !(await response.text()).includes('packager-status:running')) throw new Error('Not Metro');
      console.log(`PASS Metro ${config.webUrl}`);
    } catch { console.log('Metro is not reachable (expected when running only dev:server).'); }
    if (apiReady) console.log(`On the device, open ${config.apiUrl}/api/health. It should show status: ok. This computer-only check cannot prove device/firewall reachability.`);
    console.log('Use the same trusted LAN. Allow Expo Go local-network access. If needed, see docs/LOCAL_DEVELOPMENT.md for the Windows firewall helper. No model calls were made.');
    return;
  }
  const serverOnly = flags.has('--server-only');
  const appOnly = flags.has('--app-only');
  if (!appOnly) await assertPortFree(config.apiPort, 'API');
  if (!serverOnly) await assertPortFree(config.expoPort, 'Expo');
  if (!appOnly) start('API', [require.resolve('tsx/cli'), 'watch', 'src/index.ts'], resolve(root, 'apps/server'), apiEnvironment(env, config), false);
  const ready = await waitForApi(config.apiUrl);
  if (!ready || stopping) return;
  console.log(`API ready. AI ${ready.aiConfigured ? 'configured' : 'disabled until a key is added'}.`);
  if (serverOnly) { console.log('Run npm run dev:app in a second terminal. Ctrl+C stops the API.'); return; }
  console.log('Scan the Expo QR code on a device on the same LAN. No server URL entry is needed in the app.\nCtrl+C stops both processes. Restart after changing .env or networks.\n');
  start('Expo', [require.resolve('expo/bin/cli'), 'start', '--go', '--lan', '--port', String(config.expoPort), ...(flags.has('--web') ? ['--web'] : []), ...(flags.has('--clear') ? ['--clear'] : [])], resolve(root, 'apps/mobile'), expoEnvironment(process.env, config), true);
}
main().catch(async error => { console.error(`\n${(error as Error).message}`); await stop(1); });
