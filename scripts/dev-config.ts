/** @file Selects local/hosted development, resolves LAN addresses, and isolates Expo from all backend credentials. */

import { readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { isIPv4 } from 'node:net';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

type Environment = Record<string, string | undefined>;
export type LanAddress = { name: string; address: string };
export type DevelopmentBackend = 'local' | 'remote';

/** Validate launcher arguments before reading credentials or starting any services. */
export function developmentOptions(args: string[]) {
  const flags = new Set(args);
  const supported = ['--local', '--remote', '--web', '--server-only', '--app-only', '--setup', '--doctor', '--clear', '--help'];
  const unknown = [...flags].filter(flag => !supported.includes(flag));
  if (unknown.length) throw new Error(`Unknown option: ${unknown.join(', ')}. Use npm run dev -- --help.`);
  if (['--server-only', '--app-only', '--setup', '--doctor'].filter(flag => flags.has(flag)).length > 1) throw new Error('Choose one launch mode.');
  if (flags.has('--remote') && ['--local', '--server-only', '--setup'].some(flag => flags.has(flag))) throw new Error('--remote cannot be combined with --local, --server-only, or --setup.');
  const backend: DevelopmentBackend = flags.has('--remote') ? 'remote' : 'local';
  return { flags, backend, startApi: backend === 'local' && !flags.has('--app-only') };
}

/**
 * List reachable non-loopback IPv4 candidates, preferring private physical-network interfaces over
 * virtual adapters.
 */
export function lanAddresses(interfaces: Record<string, NetworkInterfaceInfo[] | undefined> = networkInterfaces()): LanAddress[] {
  return Object.entries(interfaces).flatMap(([name, entries]) => (entries ?? [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'))
    .map(entry => ({ name, address: entry.address })))
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}
function score(value: LanAddress) {
  const virtual = /vethernet|virtual|wsl|docker|vmware|vbox|hyper-v|tailscale|zerotier|vpn|tun\d|utun|tap\d|bridge|^br-/i.test(value.name);
  const privateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value.address);
  return (virtual ? -100 : 0) + (privateIp ? 20 : 0) + (/wi-?fi|wlan|ethernet|^en\d|^eth\d/i.test(value.name) ? 10 : 0);
}
function port(value: string | undefined, fallback: number, name: string) {
  if (!value?.trim()) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new Error(`${name} must be a port between 1024 and 65535.`);
  return Number(value);
}
/**
 * Derive Expo LAN URLs and the selected API origin. Remote sessions ignore local API port settings;
 * their optional override must be an HTTPS origin without credentials, a path, a query, or a fragment.
 */
export function developmentConfig(env: Environment, addresses = lanAddresses(), backend: DevelopmentBackend = 'local') {
  const host = env.DEV_HOST?.trim() || addresses[0]?.address;
  if (!host) throw new Error('No LAN IPv4 address found. Connect to Wi-Fi/Ethernet, or set DEV_HOST in .env.');
  if (!isIPv4(host) || host === '0.0.0.0' || host.startsWith('127.') || host.startsWith('169.254.')) throw new Error('DEV_HOST must be this computer’s reachable LAN IPv4 address, not localhost, a URL, or 0.0.0.0.');
  if (!addresses.some(entry => entry.address === host)) throw new Error('DEV_HOST is not assigned to this computer. Run npm run dev:doctor to list current addresses, then update .env.');
  const apiPort = backend === 'local' ? port(env.DEV_API_PORT, 8788, 'DEV_API_PORT') : 8788;
  const expoPort = port(env.DEV_EXPO_PORT, 8081, 'DEV_EXPO_PORT');
  if (backend === 'local' && apiPort === expoPort) throw new Error('DEV_API_PORT and DEV_EXPO_PORT must be different.');
  let apiUrl = `http://${host}:${apiPort}`;
  if (backend === 'remote') {
    const value = env.DEV_REMOTE_API_URL?.trim() || 'https://littlesay.app';
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('DEV_REMOTE_API_URL must be an HTTPS origin.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('DEV_REMOTE_API_URL must be an HTTPS origin without credentials, paths, queries, or fragments.');
    apiUrl = url.origin;
  }
  const webUrl = `http://${host}:${expoPort}`;
  return { backend, host, apiPort, expoPort, apiUrl, webUrl, expoUrl: `exp://${host}:${expoPort}`, addresses,
    origins: [webUrl, `http://localhost:${expoPort}`, `http://127.0.0.1:${expoPort}`, apiUrl, `http://localhost:${apiPort}`, `http://127.0.0.1:${apiPort}`] };
}
export type DevelopmentConfig = ReturnType<typeof developmentConfig>;

/**
 * Read .env then .env.local, with defined inherited values taking precedence. Return a separate
 * environment without mutating the launcher; pass it through expoEnvironment before launching Expo.
 */
export async function loadDevelopmentEnv(root: string, inherited: Environment = process.env): Promise<Environment> {
  const fromFiles: Environment = {};
  for (const name of ['.env', '.env.local']) {
    try { Object.assign(fromFiles, parse(await readFile(resolve(root, name)))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return { ...fromFiles, ...Object.fromEntries(Object.entries(inherited).filter(([, value]) => value !== undefined)) };
}
async function windowsUserApiKey(): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::Write([Environment]::GetEnvironmentVariable('AAC_OPENAI_KEY', 'User'))"], { windowsHide: true, timeout: 5000, maxBuffer: 16384 });
    return stdout.trim() || undefined;
  } catch { throw new Error('Could not read AAC_OPENAI_KEY from the Windows user environment. Open a fresh terminal or configure it in the root .env.'); }
}
/**
 * Use an existing API key or read the Windows user-level AAC_OPENAI_KEY as a fallback without changing
 * the caller environment.
 */
export async function withDevelopmentApiKey(env: Environment, readUserKey = windowsUserApiKey): Promise<Environment> {
  if (env.AAC_OPENAI_KEY?.trim() || env.OPENAI_API_KEY?.trim()) return env;
  const key = await readUserKey();
  return key ? { ...env, AAC_OPENAI_KEY: key } : env;
}
/** Create the root .env from its example only when absent; return whether a file was created. */
export async function ensureDevelopmentEnv(root: string) {
  try {
    await writeFile(resolve(root, '.env'), await readFile(resolve(root, '.env.example')), { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
}
/**
 * Build the API process environment with LAN binding, the selected port, and matching development
 * origins.
 */
export function apiEnvironment(env: Environment, config: DevelopmentConfig): Environment {
  if (config.backend !== 'local') throw new Error('A remote development session must not start a local API.');
  return { ...env, NODE_ENV: 'development', HOST: config.host, PORT: String(config.apiPort), ALLOWED_ORIGINS: config.origins.join(',') };
}
/**
 * Remove server secrets and inherited client overrides, then inject the selected API URL and Expo
 * LAN host. Browser sessions use Metro's same-origin API proxy; native clients connect directly.
 */
export function expoEnvironment(inherited: Environment, config: DevelopmentConfig): Environment {
  const env = { ...inherited };
  for (const key of Object.keys(env)) {
    if (/^(AAC_|OPENAI_|PG|FIREBASE_|GOOGLE_|MEDIA_|TASKS_|WORKER_|COMPOSE_|EXPO_PUBLIC_|DEV_|LITTLE_SAY_DEV_|ALLOWED_ORIGINS$|WEB_ROOT$|HOST$|PORT$|EXPO_PACKAGER_PROXY_URL$|EXPO_NO_CLIENT_ENV_VARS$)/i.test(key)) delete env[key];
  }
  return { ...env, NODE_ENV: 'development', EXPO_NO_DOTENV: '1', EXPO_PUBLIC_API_URL: config.apiUrl, REACT_NATIVE_PACKAGER_HOSTNAME: config.host,
    LITTLE_SAY_DEV_PROXY_URL: config.apiUrl, EXPO_PUBLIC_WEB_API_URL: config.webUrl };
}
