import { readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { isIPv4 } from 'node:net';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

type Environment = Record<string, string | undefined>;
export type LanAddress = { name: string; address: string };

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
export function developmentConfig(env: Environment, addresses = lanAddresses()) {
  const host = env.DEV_HOST?.trim() || addresses[0]?.address;
  if (!host) throw new Error('No LAN IPv4 address found. Connect to Wi-Fi/Ethernet, or set DEV_HOST in .env.');
  if (!isIPv4(host) || host === '0.0.0.0' || host.startsWith('127.') || host.startsWith('169.254.')) throw new Error('DEV_HOST must be this computer’s reachable LAN IPv4 address, not localhost, a URL, or 0.0.0.0.');
  if (!addresses.some(entry => entry.address === host)) throw new Error('DEV_HOST is not assigned to this computer. Run npm run dev:doctor to list current addresses, then update .env.');
  const apiPort = port(env.DEV_API_PORT, 8788, 'DEV_API_PORT');
  const expoPort = port(env.DEV_EXPO_PORT, 8081, 'DEV_EXPO_PORT');
  if (apiPort === expoPort) throw new Error('DEV_API_PORT and DEV_EXPO_PORT must be different.');
  const apiUrl = `http://${host}:${apiPort}`;
  const webUrl = `http://${host}:${expoPort}`;
  return { host, apiPort, expoPort, apiUrl, webUrl, expoUrl: `exp://${host}:${expoPort}`, addresses,
    origins: [webUrl, `http://localhost:${expoPort}`, `http://127.0.0.1:${expoPort}`, apiUrl, `http://localhost:${apiPort}`, `http://127.0.0.1:${apiPort}`] };
}
export type DevelopmentConfig = ReturnType<typeof developmentConfig>;

/** File values never enter the launcher's global environment or Expo's environment. */
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
export async function withDevelopmentApiKey(env: Environment, readUserKey = windowsUserApiKey): Promise<Environment> {
  if (env.AAC_OPENAI_KEY?.trim() || env.OPENAI_API_KEY?.trim()) return env;
  const key = await readUserKey();
  return key ? { ...env, AAC_OPENAI_KEY: key } : env;
}
export async function ensureDevelopmentEnv(root: string) {
  try {
    await writeFile(resolve(root, '.env'), await readFile(resolve(root, '.env.example')), { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
}
export function apiEnvironment(env: Environment, config: DevelopmentConfig): Environment {
  return { ...env, NODE_ENV: 'development', HOST: '0.0.0.0', PORT: String(config.apiPort), ALLOWED_ORIGINS: config.origins.join(',') };
}
export function expoEnvironment(inherited: Environment, config: DevelopmentConfig): Environment {
  const env = { ...inherited };
  for (const key of Object.keys(env)) {
    if (/^(AAC_OPENAI_KEY$|OPENAI_|EXPO_PUBLIC_|DEV_|ALLOWED_ORIGINS$|WEB_ROOT$|HOST$|PORT$|EXPO_PACKAGER_PROXY_URL$|EXPO_NO_CLIENT_ENV_VARS$)/i.test(key)) delete env[key];
  }
  return { ...env, NODE_ENV: 'development', EXPO_NO_DOTENV: '1', EXPO_PUBLIC_API_URL: config.apiUrl, REACT_NATIVE_PACKAGER_HOSTNAME: config.host };
}
