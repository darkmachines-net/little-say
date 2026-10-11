/** @file Verifies host deployment health gates and CI tunnel credential cleanup without Docker or network access. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The dependency-free host entrypoint runs directly in Node and has no declaration package.
import { deploy } from '../../deploy/scripts/self-hosted-deploy.mjs';
// @ts-expect-error The dependency-free Linux runner entrypoint has no declaration package.
import { connectAndDeploy, deploymentInputs } from '../../deploy/scripts/connect-and-deploy.mjs';

const temporaryDirectories: string[] = [];

function directory() {
  const result = fs.mkdtempSync(path.join(os.tmpdir(), 'little-say-deployment-test-'));
  temporaryDirectories.push(result);
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const temporary of temporaryDirectories.splice(0)) fs.rmSync(temporary, { recursive: true, force: true });
});

function hostFixture(options: { failure?: string; health?: string; ids?: string } = {}) {
  const projectDirectory = directory();
  const compose = 'services:\n  little-say:\n    image: ghcr.io/mchartier/little-say:latest\n';
  const environment = 'SECRET=keep-me\nLITTLE_SAY_SERVER_IMAGE=ghcr.io/mchartier/little-say:latest\n';
  fs.writeFileSync(path.join(projectDirectory, 'compose.yaml'), compose);
  fs.writeFileSync(path.join(projectDirectory, '.env'), environment);
  const config = { projectDirectory, projectName: 'existing-little-say', composeFiles: ['compose.yaml'], envFile: '.env', waitTimeoutSeconds: 300 };
  const calls: string[][] = [];
  const logs: string[] = [];
  const runDocker = (args: string[], cwd: string) => {
    expect(cwd).toBe(projectDirectory);
    calls.push(args);
    if (args[0] === 'compose') {
      expect(args[args.indexOf('--project-name') + 1]).toBe(config.projectName);
      if (args.includes('pull')) {
        if (options.failure === 'pull') throw new Error('SECRET=registry-password');
        return '';
      }
      if (args.includes('up')) {
        if (options.failure === 'up') throw new Error('SECRET=startup-password');
        return '';
      }
      if (args.includes('ps')) return options.ids ?? 'c'.repeat(64);
    }
    if (args[0] === 'inspect') return options.health ?? 'healthy';
    if (args[0] === 'exec') {
      if (options.failure === 'probe') throw new Error('SECRET=application-password');
      return '';
    }
    throw new Error('Unexpected Docker command.');
  };
  return { config, calls, logs, compose, environment, run: () => deploy(config, { runDocker, log: (message: string) => logs.push(message) }) };
}

describe('private host deployment', () => {
  it('pulls and upgrades only little-say using existing files and requires Docker and API health', () => {
    const fixture = hostFixture();
    const originalConfig = structuredClone(fixture.config);
    fixture.run();
    const [pull, up, ps, inspect, probe] = fixture.calls;
    expect(pull.slice(pull.indexOf('pull'))).toEqual(['pull', '--policy', 'always', 'little-say']);
    expect(up.slice(up.indexOf('up'))).toEqual([
      'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '300', 'little-say',
    ]);
    expect(up.filter(value => value === '--env-file')).toHaveLength(1);
    expect(up[up.indexOf('--env-file') + 1]).toBe(path.join(fixture.config.projectDirectory, '.env'));
    expect(up[up.indexOf('-f') + 1]).toBe(path.join(fixture.config.projectDirectory, 'compose.yaml'));
    expect(ps.slice(-4)).toEqual(['ps', '--all', '--quiet', 'little-say']);
    expect(inspect).toEqual(['inspect', '--format', '{{.State.Health.Status}}', 'c'.repeat(64)]);
    expect(probe.slice(0, 5)).toEqual(['exec', 'c'.repeat(64), 'node', '--input-type=module', '-e']);
    expect(fixture.config).toEqual(originalConfig);
    expect(fs.readFileSync(path.join(fixture.config.projectDirectory, 'compose.yaml'), 'utf8')).toBe(fixture.compose);
    expect(fs.readFileSync(path.join(fixture.config.projectDirectory, '.env'), 'utf8')).toBe(fixture.environment);
    expect(fs.readdirSync(fixture.config.projectDirectory).sort()).toEqual(['.env', 'compose.yaml']);
    expect(fixture.logs.at(-1)).toBe('Deployment and application health check succeeded.');
  });

  it('repeats normal deployment on retry without writing deployment state', () => {
    const fixture = hostFixture();
    fixture.run();
    fixture.run();
    expect(fixture.calls.filter(args => args.includes('pull'))).toHaveLength(2);
    expect(fixture.calls.filter(args => args.includes('up'))).toHaveLength(2);
    expect(fs.readdirSync(fixture.config.projectDirectory).sort()).toEqual(['.env', 'compose.yaml']);
  });

  it.each(['pull', 'up', 'probe'])('stops on %s failure and suppresses captured secrets', failure => {
    const fixture = hostFixture({ failure });
    expect(fixture.run).toThrow(/^Docker (compose|exec) failed;/);
    expect(fixture.logs.join('\n')).not.toMatch(/SECRET|succeeded/);
    if (failure === 'pull') expect(fixture.calls.some(args => args.includes('up'))).toBe(false);
    if (failure === 'up') expect(fixture.calls.some(args => args[0] === 'inspect')).toBe(false);
  });

  it.each(['unhealthy', 'starting', '<no value>', ''])('rejects Docker health %j before the API probe', health => {
    const fixture = hostFixture({ health });
    expect(fixture.run).toThrow('health check did not succeed');
    expect(fixture.calls.some(args => args[0] === 'exec')).toBe(false);
    expect(fixture.logs.join('\n')).not.toContain('succeeded');
  });

  it.each(['', `${'c'.repeat(64)}\n${'d'.repeat(64)}`, '--container', 'too-short'])('requires exactly one container, rejecting %j', ids => {
    const fixture = hostFixture({ ids });
    expect(fixture.run).toThrow('Expected exactly one');
    expect(fixture.calls.some(args => args[0] === 'inspect')).toBe(false);
  });

  it.each([
    { composeFiles: [] }, { composeFiles: ['../compose.yaml'] }, { composeFiles: ['missing.yaml'] },
    { envFile: '../.env' }, { envFile: 'missing.env' }, { projectDirectory: 'relative' },
    { projectName: '--other' }, { waitTimeoutSeconds: 0 }, { waitTimeoutSeconds: 481 }, { waitTimeoutSeconds: 1.5 },
  ])('rejects invalid configuration before Docker: %j', override => {
    const fixture = hostFixture();
    Object.assign(fixture.config, override);
    expect(fixture.run).toThrow();
    expect(fixture.calls).toHaveLength(0);
  });

  it('uses each configured Compose file in order', () => {
    const fixture = hostFixture();
    fs.writeFileSync(path.join(fixture.config.projectDirectory, 'override.yaml'), 'services: {}\n');
    fixture.config.composeFiles.push('override.yaml');
    fixture.run();
    const files = fixture.calls[0].flatMap((value, index, args) => value === '-f' ? [args[index + 1]] : []);
    expect(files).toEqual(fixture.config.composeFiles.map(file => path.join(fixture.config.projectDirectory, file)));
  });

  it.each([
    { ok: true, body: { status: 'ok' }, success: true },
    { ok: false, body: { status: 'ok' }, success: false },
    { ok: true, body: { status: 'degraded' }, success: false },
    { ok: true, body: {}, success: false },
    { ok: true, body: null, success: false },
  ])('requires an affirmative API response: %j', async ({ ok, body, success }) => {
    const fixture = hostFixture();
    fixture.run();
    const probe = fixture.calls.find(args => args[0] === 'exec')!.at(-1)!;
    const fetch = vi.fn(async () => ({ ok, json: async () => body }));
    const timeout = vi.fn(() => 'timeout-signal');
    const result = runInNewContext(`(async () => { ${probe} })()`, { fetch, AbortSignal: { timeout } });
    if (success) await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toThrow('Application health check did not succeed');
    expect(timeout).toHaveBeenCalledWith(10000);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8787/api/ready', { cache: 'no-store', signal: 'timeout-signal' });
  });
});

const runnerEnvironment = {
  DEPLOY_HOST: '10.8.0.1', DEPLOY_WG_ADDRESS: '10.8.0.20',
  DEPLOY_SSH_USER: 'little-say-deploy', DEPLOY_WG_ENDPOINT: 'vpn.example.test:51820',
  DEPLOY_WG_PUBLIC_KEY: `${'a'.repeat(43)}=`, DEPLOY_WG_PRIVATE_KEY: `${'b'.repeat(43)}=`,
  DEPLOY_SSH_PRIVATE_KEY: 'test-only-private-ssh-key', DEPLOY_SSH_KNOWN_HOSTS: '10.8.0.1 ssh-ed25519 test-key',
};

describe('CI connection', () => {
  it.each([
    { DEPLOY_HOST: '0.0.0.0/0' }, { DEPLOY_HOST: '-oProxyCommand=id' },
    { DEPLOY_WG_ADDRESS: '10.8.0.1' }, { DEPLOY_WG_ADDRESS: '10.8.0.20/24' },
    { DEPLOY_SSH_USER: 'root; id' }, { DEPLOY_WG_ENDPOINT: 'vpn.example.test:0' },
    { DEPLOY_WG_ENDPOINT: 'vpn.example.test:65536' }, { DEPLOY_WG_ENDPOINT: 'vpn.example.test:51820\nextra' },
    { DEPLOY_WG_PRIVATE_KEY: '' }, { DEPLOY_WG_PUBLIC_KEY: '' },
    { DEPLOY_SSH_PRIVATE_KEY: '' }, { DEPLOY_SSH_KNOWN_HOSTS: '' },
  ])('rejects unsafe or missing network configuration before commands: %j', override => {
    expect(() => deploymentInputs(runnerEnvironment)).not.toThrow();
    const run = vi.fn();
    expect(() => connectAndDeploy({ ...runnerEnvironment, ...override }, run)).toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['success', 'link', 'wg', 'ssh', 'cleanup', 'ssh-and-cleanup'])('pins SSH and cleans credentials and networking after %s', failureStage => {
    const runnerDirectory = directory();
    vi.spyOn(os, 'tmpdir').mockReturnValue(runnerDirectory);
    const summary = path.join(runnerDirectory, 'summary.md');
    const calls: { binary: string; args: string[] }[] = [];
    const run = (binary: string, args: string[], options: { stdio: string[]; timeout: number; input?: unknown }) => {
      calls.push({ binary, args });
      const isLinkCreation = args[0] === 'ip' && args[1] === 'link' && args[2] === 'add';
      if (isLinkCreation && failureStage === 'link') throw new Error('SECRET=link-error');
      if (args[0] === 'wg') {
        const keyPath = args[args.indexOf('private-key') + 1];
        expect(fs.readFileSync(keyPath, 'utf8')).toBe(`${runnerEnvironment.DEPLOY_WG_PRIVATE_KEY}\n`);
        expect(args[args.indexOf('allowed-ips') + 1]).toBe('10.8.0.1/32');
        expect(args[2]).toBe('little-say-ci');
        expect(args[2].length).toBeLessThanOrEqual(15);
        if (process.platform !== 'win32') {
          expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
          expect(fs.statSync(path.dirname(keyPath)).mode & 0o777).toBe(0o700);
        }
        if (failureStage === 'wg') throw new Error('SECRET=wireguard-error');
      }
      if (binary === 'ssh') {
        expect(args).toEqual(expect.arrayContaining(['-F', '/dev/null', '-n', '-T', 'StrictHostKeyChecking=yes', 'BatchMode=yes', 'IdentitiesOnly=yes', 'GlobalKnownHostsFile=/dev/null']));
        expect(args.at(-1)).toBe('little-say-deploy@10.8.0.1');
        expect(args.join(' ')).not.toContain(runnerEnvironment.DEPLOY_SSH_PRIVATE_KEY);
        expect(options.input).toBeUndefined();
        expect(options.stdio[0]).toBe('ignore');
        expect(options.timeout).toBe(20 * 60 * 1000);
        const sshKey = args[args.indexOf('-i') + 1];
        const knownHosts = args.find(value => value.startsWith('UserKnownHostsFile='))!.split('=')[1];
        expect(fs.readFileSync(sshKey, 'utf8')).toBe(`${runnerEnvironment.DEPLOY_SSH_PRIVATE_KEY}\n`);
        expect(fs.readFileSync(knownHosts, 'utf8')).toBe(`${runnerEnvironment.DEPLOY_SSH_KNOWN_HOSTS}\n`);
        if (failureStage.startsWith('ssh')) throw new Error('SECRET=ssh-error');
      }
      if (args[2] === 'delete' && failureStage.includes('cleanup')) throw new Error('SECRET=cleanup-error');
      return '';
    };
    const invoke = () => connectAndDeploy({ ...runnerEnvironment, GITHUB_STEP_SUMMARY: summary }, run);
    if (failureStage === 'success') invoke();
    else expect(invoke).toThrow(/^Deployment (failed|tunnel cleanup failed)\./);
    const cleanup = { binary: 'sudo', args: ['ip', 'link', 'delete', 'little-say-ci'] };
    if (failureStage === 'link') expect(calls).not.toContainEqual(cleanup);
    else expect(calls.at(-1)).toEqual(cleanup);
    if (failureStage === 'success') {
      expect(calls).toContainEqual({ binary: 'sudo', args: ['ip', 'route', 'add', '10.8.0.1/32', 'dev', 'little-say-ci'] });
      expect(fs.readFileSync(summary, 'utf8')).toContain('application health check succeeded');
      expect(fs.readdirSync(runnerDirectory)).toEqual(['summary.md']);
    } else expect(fs.readdirSync(runnerDirectory)).toEqual([]);
  });
});

it('keeps the privileged wrapper fixed, argument-free, and isolated from the SSH environment', () => {
  const wrapper = fs.readFileSync(new URL('../../deploy/self-hosted/little-say-deploy', import.meta.url), 'utf8');
  expect(wrapper).toContain('[ "$#" -eq 0 ] || exit 1');
  expect(wrapper).toContain('/usr/bin/env -i PATH=/usr/bin:/bin DOCKER_CONFIG=/etc/little-say/registry');
  expect(wrapper).toContain('/usr/bin/node /usr/local/lib/little-say-deploy.mjs </dev/null');
  expect(wrapper).not.toMatch(/SSH_ORIGINAL_COMMAND|\$@|\$\*/);
});
