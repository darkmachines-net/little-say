/** @file Verifies private webhook request boundaries, affirmative deployment results, and runner cleanup without network access. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The dependency-free Linux runner entrypoint has no declaration package.
import { connectAndDeploy, deploymentInputs } from '../../deploy/scripts/connect-and-deploy.mjs';

const temporaryDirectories: string[] = [];
const runnerEnvironment = {
  DEPLOY_HOST: '10.8.0.1', DEPLOY_WG_ADDRESS: '10.8.0.20',
  DEPLOY_WG_ENDPOINT: 'vpn.example.test:51820',
  DEPLOY_WG_PUBLIC_KEY: `${'a'.repeat(43)}=`, DEPLOY_WG_PRIVATE_KEY: `${'b'.repeat(43)}=`,
  DEPLOY_URL: 'https://deployer.darkmachines.net/deploy/little-say', DEPLOY_TOKEN: '0123456789abcdef'.repeat(4),
};
const successResponse = { service: 'little-say', status: 'succeeded', healthy: true };
const successOutput = `${JSON.stringify(successResponse)}\n200`;
const cleanupCommand = ['ip', 'link', 'delete', 'little-say-ci'];

interface CommandOptions { stdio: string[]; timeout: number; input?: string; maxBuffer?: number; encoding?: string; }
interface Command { binary: string; args: string[]; options: CommandOptions; }

function directory() {
  const result = fs.mkdtempSync(path.join(os.tmpdir(), 'little-say-deployment-test-'));
  temporaryDirectories.push(result);
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const temporary of temporaryDirectories.splice(0)) fs.rmSync(temporary, { recursive: true, force: true });
});

function runnerFixture({ response = successOutput, failure = '', cleanupFailure = false } = {}) {
  const runnerDirectory = directory();
  vi.spyOn(os, 'tmpdir').mockReturnValue(runnerDirectory);
  const summary = path.join(runnerDirectory, 'summary.md');
  const creation = vi.spyOn(fs, 'mkdtempSync');
  const calls: Command[] = [];
  let keyContents = '';
  let privateFiles: string[] = [];
  let keyMode = 0;
  let directoryMode = 0;
  const run = (binary: string, args: string[], options: CommandOptions) => {
    calls.push({ binary, args, options });
    const stage = binary === 'curl' ? 'request' : args[0] === 'wg' ? 'wireguard'
      : args[1] === 'address' ? 'address' : args[1] === 'route' ? 'route'
        : args[2] === 'add' ? 'create' : args[2] === 'set' ? 'up' : 'cleanup';
    if (stage === 'wireguard') {
      const key = args[args.indexOf('private-key') + 1];
      keyContents = fs.readFileSync(key, 'utf8');
      keyMode = fs.statSync(key).mode & 0o777;
      directoryMode = fs.statSync(path.dirname(key)).mode & 0o777;
      privateFiles = fs.readdirSync(path.dirname(key));
    }
    if (stage === failure || (stage === 'cleanup' && cleanupFailure)) {
      throw new Error(`SECRET=${runnerEnvironment.DEPLOY_TOKEN}; response and private diagnostics`);
    }
    return binary === 'curl' ? response : '';
  };
  const env = { ...runnerEnvironment, GITHUB_STEP_SUMMARY: summary };
  return {
    runnerDirectory, summary, creation, calls, env, run,
    invoke: () => connectAndDeploy(env, run),
    credentials: () => ({ keyContents, keyMode, directoryMode, privateFiles }),
  };
}

function value(args: string[], option: string) { return args[args.indexOf(option) + 1]; }

describe('deployment configuration', () => {
  it.each(['0123456789abcdef'.repeat(4), `${'a'.repeat(41)}_-`, 'a'.repeat(128)])('accepts a shared-service token format: %s', token => {
    const url = deploymentInputs({ ...runnerEnvironment, DEPLOY_TOKEN: token });
    expect(url.href).toBe(runnerEnvironment.DEPLOY_URL);
  });

  it.each([
    { DEPLOY_HOST: '' }, { DEPLOY_HOST: '0.0.0.0/0' }, { DEPLOY_HOST: '-oProxyCommand=id' },
    { DEPLOY_WG_ADDRESS: '10.8.0.1' }, { DEPLOY_WG_ADDRESS: '10.8.0.20/24' },
    { DEPLOY_WG_ENDPOINT: 'vpn.example.test:0' }, { DEPLOY_WG_ENDPOINT: 'vpn.example.test:65536' },
    { DEPLOY_WG_ENDPOINT: 'vpn.example.test:51820\n' }, { DEPLOY_WG_ENDPOINT: 'vpn.example.test:51820;id' },
    { DEPLOY_WG_PRIVATE_KEY: '' }, { DEPLOY_WG_PUBLIC_KEY: '' },
    { DEPLOY_WG_PRIVATE_KEY: `${runnerEnvironment.DEPLOY_WG_PRIVATE_KEY}\n` },
    { DEPLOY_TOKEN: '' }, { DEPLOY_TOKEN: 'a'.repeat(42) }, { DEPLOY_TOKEN: 'a'.repeat(129) },
    { DEPLOY_TOKEN: `${'a'.repeat(43)}\n` }, { DEPLOY_TOKEN: `${'a'.repeat(43)}"` },
    { DEPLOY_TOKEN: `${'a'.repeat(43)}\\` }, { DEPLOY_TOKEN: `${'a'.repeat(43)}=` },
    { DEPLOY_URL: '' }, { DEPLOY_URL: '/deploy/little-say' },
    { DEPLOY_URL: 'http://deploy.example.test/deploy/little-say' },
    { DEPLOY_URL: 'https://deploy.example.test/deploy/calibratehealth' },
    { DEPLOY_URL: 'https://deploy.example.test/deploy/little-say/' },
    { DEPLOY_URL: 'https://deploy.example.test/deploy/little-say?image=latest' },
    { DEPLOY_URL: 'https://deploy.example.test/deploy/little-say?' },
    { DEPLOY_URL: 'https://deploy.example.test/deploy/little-say#fragment' },
    { DEPLOY_URL: 'https://deploy.example.test/deploy/little-say#' },
    { DEPLOY_URL: 'https://user:password@deploy.example.test/deploy/little-say' },
    { DEPLOY_URL: 'https://10.8.0.2/deploy/little-say' },
    { DEPLOY_URL: 'https://[::1]/deploy/little-say' },
    { DEPLOY_URL: 'https://deploy.example.test/deploy/little-say\n' },
  ])('rejects invalid configuration before files or networking: %j', override => {
    const run = vi.fn();
    const create = vi.spyOn(fs, 'mkdtempSync');
    expect(() => connectAndDeploy({ ...runnerEnvironment, ...override }, run)).toThrow();
    expect(run).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('private deployment request', () => {
  it.each([
    ['https://deployer.darkmachines.net/deploy/little-say', 'deployer.darkmachines.net:443:10.8.0.1'],
    ['https://deploy.example.test:8443/deploy/little-say', 'deploy.example.test:8443:10.8.0.1'],
    ['https://10.8.0.1/deploy/little-say', '10.8.0.1:443:10.8.0.1'],
  ])('POSTs once to %s with private resolution and verified TLS', (url, resolve) => {
    const fixture = runnerFixture();
    fixture.env.DEPLOY_URL = url;
    const before = structuredClone(fixture.env);
    fixture.invoke();
    expect(fixture.env).toEqual(before);
    const requests = fixture.calls.filter(call => call.binary === 'curl');
    expect(requests).toHaveLength(1);
    const { args, options } = requests[0];
    expect(args[0]).toBe('--disable');
    expect(value(args, '--proto')).toBe('=https');
    expect(value(args, '--noproxy')).toBe('*');
    expect(value(args, '--request')).toBe('POST');
    expect(value(args, '--resolve')).toBe(resolve);
    expect(value(args, '--url')).toBe(url);
    expect(value(args, '--connect-timeout')).toBe('15');
    expect(value(args, '--max-time')).toBe('780');
    expect(value(args, '--retry')).toBe('0');
    expect(value(args, '--write-out')).toBe('\n%{http_code}');
    expect(value(args, '--config')).toBe('-');
    for (const forbidden of ['--insecure', '-k', '--location', '-L', '--location-trusted', '--proxy']) expect(args).not.toContain(forbidden);
    expect(args.some(arg => /^--(data|form|upload|json)/.test(arg))).toBe(false);
    expect(args.join(' ')).not.toContain(runnerEnvironment.DEPLOY_TOKEN);
    expect(args.join(' ')).not.toContain(runnerEnvironment.DEPLOY_WG_PRIVATE_KEY);
    expect(options.input).toBe(`header = "Authorization: Bearer ${runnerEnvironment.DEPLOY_TOKEN}"\n`);
    expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(options.encoding).toBe('utf8');
    expect(options.timeout).toBe(790000);
    expect(options.maxBuffer).toBe(65536);
    expect(fixture.calls.some(call => call.binary === 'ssh')).toBe(false);
    expect(fixture.calls.find(call => call.args[0] === 'wg')?.args).toEqual(expect.arrayContaining([
      'little-say-ci', 'allowed-ips', '10.8.0.1/32', 'endpoint', 'vpn.example.test:51820',
    ]));
    expect(fixture.calls.some(call => call.args.join(' ') === 'ip route add 10.8.0.1/32 dev little-say-ci')).toBe(true);
    expect(fixture.calls.at(-1)?.args).toEqual(cleanupCommand);
    expect(fixture.credentials().keyContents).toBe(`${runnerEnvironment.DEPLOY_WG_PRIVATE_KEY}\n`);
    expect(fixture.credentials().privateFiles).toEqual(['wireguard.key']);
    if (process.platform !== 'win32') {
      expect(fixture.credentials().keyMode).toBe(0o600);
      expect(fixture.credentials().directoryMode).toBe(0o700);
    }
    expect(fs.readdirSync(fixture.runnerDirectory)).toEqual(['summary.md']);
    expect(fs.readFileSync(fixture.summary, 'utf8')).toBe('Homelab webhook confirmed Little Say deployment and application health.\n');
  });

  it.each(['000', '201', '202', '204', '301', '302', '401', '409', '502', '504'])('rejects HTTP %s without retrying even with a success body', status => {
    const fixture = runnerFixture({ response: `${JSON.stringify(successResponse)}\n${status}` });
    expect(fixture.invoke).toThrow('Deployment failed or health was not confirmed');
    expect(fixture.calls.filter(call => call.binary === 'curl')).toHaveLength(1);
    expect(fixture.calls.at(-1)?.args).toEqual(cleanupCommand);
    expect(fs.readdirSync(fixture.runnerDirectory)).toEqual([]);
  });

  it.each([
    '{}', 'null', '[]', 'true', 'not JSON with SECRET=raw-response',
    JSON.stringify({ ...successResponse, service: 'calibratehealth' }),
    JSON.stringify({ ...successResponse, status: 'accepted' }),
    JSON.stringify({ ...successResponse, status: 'failed' }),
    JSON.stringify({ ...successResponse, healthy: false }),
    JSON.stringify({ ...successResponse, healthy: 'true' }),
    JSON.stringify({ service: 'little-say', status: 'succeeded' }),
  ])('requires completed service-specific affirmative JSON: %s', body => {
    const fixture = runnerFixture({ response: `${body}\n200` });
    expect(fixture.invoke).toThrow(/^Deployment failed or health was not confirmed\./);
    expect(fixture.calls.filter(call => call.binary === 'curl')).toHaveLength(1);
    expect(fixture.calls.at(-1)?.args).toEqual(cleanupCommand);
    expect(fs.readdirSync(fixture.runnerDirectory)).toEqual([]);
  });

  it.each([JSON.stringify(successResponse), `${successOutput}\n`, '200', ''])('rejects malformed HTTP framing: %j', response => {
    const fixture = runnerFixture({ response });
    expect(fixture.invoke).toThrow(/^Deployment failed or health was not confirmed\./);
    expect(fs.readdirSync(fixture.runnerDirectory)).toEqual([]);
  });
});

describe('runner cleanup and safe errors', () => {
  it.each(['create', 'address', 'wireguard', 'up', 'route', 'request'])('cleans only its own interface and private files after %s fails', failure => {
    const fixture = runnerFixture({ failure });
    expect(fixture.invoke).toThrow(/^Deployment failed or health was not confirmed\./);
    expect(fixture.calls.filter(call => call.binary === 'curl')).toHaveLength(failure === 'request' ? 1 : 0);
    if (failure === 'create') expect(fixture.calls.some(call => call.args[2] === 'delete')).toBe(false);
    else expect(fixture.calls.at(-1)?.args).toEqual(cleanupCommand);
    expect(fs.readdirSync(fixture.runnerDirectory)).toEqual([]);
  });

  it('withholds success if tunnel cleanup fails and still removes credentials', () => {
    const fixture = runnerFixture({ cleanupFailure: true });
    expect(fixture.invoke).toThrow('Deployment tunnel cleanup failed. Inspect runner networking before retrying.');
    expect(fixture.calls.filter(call => call.binary === 'curl')).toHaveLength(1);
    expect(fs.readdirSync(fixture.runnerDirectory)).toEqual([]);
  });

  it('preserves a safe request failure when tunnel cleanup also fails', () => {
    const fixture = runnerFixture({ failure: 'request', cleanupFailure: true });
    expect(fixture.invoke).toThrow(/^Deployment failed or health was not confirmed\./);
    expect(fs.readdirSync(fixture.runnerDirectory)).toEqual([]);
  });

  it('withholds success and redacts credential cleanup failures', () => {
    const fixture = runnerFixture();
    vi.spyOn(fs, 'rmSync').mockImplementation(() => { throw new Error('SECRET=private-path'); });
    expect(fixture.invoke).toThrow('Deployment credential cleanup failed. Inspect the temporary runner directory.');
    expect(fixture.calls.at(-1)?.args).toEqual(cleanupCommand);
    expect(fs.existsSync(fixture.summary)).toBe(false);
  });

  it('cleans the temporary directory without networking if writing the WireGuard key fails', () => {
    const fixture = runnerFixture();
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('SECRET=private-key'); });
    expect(fixture.invoke).toThrow(/^Deployment failed or health was not confirmed\./);
    expect(fixture.calls).toHaveLength(0);
    expect(fixture.creation).toHaveBeenCalledOnce();
    expect(fs.readdirSync(fixture.runnerDirectory)).toEqual([]);
  });

  it('does not require a GitHub summary path for an otherwise successful call', () => {
    const fixture = runnerFixture();
    connectAndDeploy(runnerEnvironment, fixture.run);
    expect(fs.readdirSync(fixture.runnerDirectory)).toEqual([]);
  });
});
