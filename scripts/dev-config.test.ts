import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, type NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';
import { apiEnvironment, developmentConfig, ensureDevelopmentEnv, expoEnvironment, lanAddresses, loadDevelopmentEnv, withDevelopmentApiKey } from './dev-config';

const addresses = [{ name: 'Wi-Fi', address: '192.168.1.20' }, { name: 'Ethernet', address: '10.0.0.30' }];
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await mkdtemp(join(tmpdir(), 'little-say-dev-test-')); temporary.push(path); return path; }

describe('local development configuration', () => {
  it('prefers the real LAN over Docker, WSL, VPN, and loopback interfaces', () => {
    const ipv4 = (address: string, internal = false) => ({ address, internal, family: 'IPv4' }) as NetworkInterfaceInfo;
    expect(lanAddresses({ 'vEthernet (Default Switch)': [ipv4('172.20.0.1')], 'Tailscale': [ipv4('100.100.1.1')], 'Loopback': [ipv4('127.0.0.1', true)], 'Ethernet': [ipv4('192.168.0.195')], 'Disconnected': [ipv4('169.254.1.2')] })[0]).toEqual({ name: 'Ethernet', address: '192.168.0.195' });
  });
  it('uses a single chosen host for API injection, Expo advertising, and web origins', () => {
    const config = developmentConfig({ DEV_HOST: '10.0.0.30', DEV_API_PORT: '9000', DEV_EXPO_PORT: '9001', HOST: '127.0.0.1', PORT: '8787' }, addresses);
    expect(config.apiUrl).toBe('http://10.0.0.30:9000'); expect(config.expoUrl).toBe('exp://10.0.0.30:9001');
    expect(config.origins).toContain('http://10.0.0.30:9001'); expect(config.origins).toContain('http://localhost:9001');
    const api = apiEnvironment({ OPENAI_API_KEY: 'backend-secret', ALLOWED_ORIGINS: '*' }, config);
    expect(api.HOST).toBe('0.0.0.0'); expect(api.PORT).toBe('9000'); expect(api.OPENAI_API_KEY).toBe('backend-secret'); expect(api.ALLOWED_ORIGINS).not.toContain('*');
  });
  it('does not pass backend keys, public secret variables, or dotenv files to Expo', () => {
    const env = { PATH: '/bin', AAC_OPENAI_KEY: 'app-secret', OPENAI_API_KEY: 'backend-secret', OPENAI_BOARD_MODEL: 'model', EXPO_PUBLIC_API_KEY: 'public-secret', EXPO_PUBLIC_API_URL: 'http://old-host', EXPO_PACKAGER_PROXY_URL: 'https://old-tunnel', EXPO_NO_CLIENT_ENV_VARS: '1' };
    const expo = expoEnvironment(env, developmentConfig({}, addresses));
    expect(expo.PATH).toBe('/bin'); expect(expo.EXPO_NO_DOTENV).toBe('1'); expect(expo.EXPO_PUBLIC_API_URL).toBe('http://192.168.1.20:8788'); expect(expo.REACT_NATIVE_PACKAGER_HOSTNAME).toBe('192.168.1.20');
    expect(JSON.stringify(expo)).not.toContain('secret'); expect(expo.OPENAI_BOARD_MODEL).toBeUndefined(); expect(expo.EXPO_PACKAGER_PROXY_URL).toBeUndefined(); expect(expo.EXPO_NO_CLIENT_ENV_VARS).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBe('backend-secret');
  });
  it('rejects wrong hosts and colliding or invalid ports before starting services', () => {
    for (const host of ['localhost', '127.0.0.1', '0.0.0.0', 'http://192.168.1.20', '192.168.1.99']) expect(() => developmentConfig({ DEV_HOST: host }, addresses)).toThrow();
    for (const value of ['0', '80', '8081abc', '-1', '65536']) expect(() => developmentConfig({ DEV_API_PORT: value }, addresses)).toThrow();
    expect(() => developmentConfig({ DEV_API_PORT: '8081' }, addresses)).toThrow('different');
    expect(() => developmentConfig({}, [])).toThrow('No LAN');
  });
  it('creates the ignored configuration once without overwriting a supplied key', async () => {
    const root = await directory(); await writeFile(join(root, '.env.example'), 'OPENAI_API_KEY=\n');
    expect(await ensureDevelopmentEnv(root)).toBe(true);
    await writeFile(join(root, '.env'), 'OPENAI_API_KEY=keep-this-key\n');
    expect(await ensureDevelopmentEnv(root)).toBe(false); expect(await readFile(join(root, '.env'), 'utf8')).toContain('keep-this-key');
  });
  it('loads root environment files with explicit environment values taking precedence', async () => {
    const root = await directory(); await writeFile(join(root, '.env'), 'OPENAI_API_KEY=base\nDEV_API_PORT=9000\n'); await writeFile(join(root, '.env.local'), 'OPENAI_API_KEY=local\n');
    expect(await loadDevelopmentEnv(root, {})).toMatchObject({ OPENAI_API_KEY: 'local', DEV_API_PORT: '9000' });
    expect(await loadDevelopmentEnv(root, { OPENAI_API_KEY: 'shell' })).toMatchObject({ OPENAI_API_KEY: 'shell', DEV_API_PORT: '9000' });
  });
  it('reads a newly set Windows user key without overwriting an explicit key', async () => {
    const readKey = async () => 'user-secret';
    expect(await withDevelopmentApiKey({ OPENAI_API_KEY: '' }, readKey)).toMatchObject({ AAC_OPENAI_KEY: 'user-secret' });
    expect(await withDevelopmentApiKey({ AAC_OPENAI_KEY: 'shell-secret' }, readKey)).toEqual({ AAC_OPENAI_KEY: 'shell-secret' });
    expect(await withDevelopmentApiKey({ OPENAI_API_KEY: 'file-secret' }, readKey)).toEqual({ OPENAI_API_KEY: 'file-secret' });
  });
});
