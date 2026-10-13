/** @file Verifies source-evaluating children receive declared inputs without publication credentials, while EAS transport retains authentication. */
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { node, npm, sourceEnvironment } from './common';
import { eas, exportBundle, nativeFingerprint, nativeRuntime } from './expo';
import { validateReleaseSource } from './validation';

vi.mock('./common', async original => ({
  ...await original<typeof import('./common')>(),
  node: vi.fn(), npm: vi.fn(), git: vi.fn(() => ''), readJson: vi.fn(() => ({ version: '22.4.0' })),
}));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

const secrets = {
  EXPO_TOKEN: 'expo-secret', GH_TOKEN: 'github-secret', GITHUB_TOKEN: 'github-secret',
  gh_enterprise_token: 'enterprise-secret', NPM_TOKEN: 'npm-secret', NODE_AUTH_TOKEN: 'node-secret',
  AWS_SECRET_ACCESS_KEY: 'cloud-secret', OPENAI_API_KEY: 'backend-secret', ARBITRARY_SECRET: 'unknown-secret',
  GITHUB_ENV: '/runner/env', GITHUB_OUTPUT: '/runner/output', GITHUB_PATH: '/runner/path',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-secret', ACTIONS_RUNTIME_TOKEN: 'runtime-secret',
  SSH_AUTH_SOCK: '/agent/socket', NODE_OPTIONS: '--require=untrusted.cjs', npm_config_userconfig: '/credentials/npmrc',
};

it('allows declared application and portable process inputs without inherited auth or runner control channels', () => {
  const inputs = {
    Path: 'portable-path', SystemRoot: 'system-root', HOME: '/home', TMPDIR: '/temp', CI: '1', LC_ALL: 'en_US.UTF-8',
    LITTLE_SAY_CHANNEL: 'production', LITTLE_SAY_OTA_VERSIONS: '{"version":"1.2.3"}',
    LITTLE_SAY_FINGERPRINT_PLATFORM: 'ios', LITTLE_SAY_GOOGLE_IOS_URL_SCHEME: 'com.google.client',
    EXPO_NO_DOTENV: '1', EXPO_PUBLIC_API_URL: 'https://example.test', TEST_PGDATABASE: 'app_test', TEST_PGPASSWORD: 'test-only',
  };
  expect(sourceEnvironment({ ...inputs, ...secrets, UNDECLARED_CONFIG: 'discarded', EXPO_PUBLIC_UNDECLARED: 'discarded' })).toEqual(inputs);
});

it('passes the reduced environment to a real child without mutating the orchestrator environment', () => {
  const original = { ...process.env, ...secrets, EXPO_NO_DOTENV: '1', LITTLE_SAY_CHANNEL: 'internal' };
  const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], {
    env: sourceEnvironment(original), encoding: 'utf8', windowsHide: true,
  });
  expect(result.status, result.stderr).toBe(0);
  const child = JSON.parse(result.stdout);
  for (const key of Object.keys(secrets)) expect(Object.keys(child).map(k => k.toUpperCase())).not.toContain(key.toUpperCase());
  expect(child.LITTLE_SAY_CHANNEL).toBe('internal');
  expect(original.EXPO_TOKEN).toBe('expo-secret');
});

it('sanitizes fingerprints, runtime resolution and bundle export while retaining version and native config inputs', () => {
  vi.mocked(node).mockReturnValue(JSON.stringify({ hash: 'a'.repeat(40), runtimeVersion: 'a'.repeat(40) }));
  const env = { ...secrets, PATH: 'path', LITTLE_SAY_CHANNEL: 'internal', LITTLE_SAY_GOOGLE_IOS_URL_SCHEME: 'scheme', EXPO_NO_DOTENV: '1' };
  nativeFingerprint('ios', env, true);
  nativeRuntime('ios', env);
  exportBundle('ios', '/export', env);
  expect(node).toHaveBeenCalledTimes(3);
  for (const [, , options] of vi.mocked(node).mock.calls) {
    expect(options?.env).toMatchObject({ PATH: 'path', LITTLE_SAY_CHANNEL: 'internal', LITTLE_SAY_GOOGLE_IOS_URL_SCHEME: 'scheme' });
    for (const key of Object.keys(secrets)) expect(options?.env).not.toHaveProperty(key);
  }
  expect(JSON.parse(vi.mocked(node).mock.calls[0][2]!.env!.LITTLE_SAY_OTA_VERSIONS!)).toEqual({ version: '0.0.0', androidVersionCode: 1, iosBuildNumber: '1' });
  expect(vi.mocked(node).mock.calls[1][2]!.env!.LITTLE_SAY_FINGERPRINT_PLATFORM).toBe('ios');
});

it('keeps release validation children credential-free and leaves authenticated EAS transport available', () => {
  for (const [key, value] of Object.entries(secrets)) vi.stubEnv(key, value);
  vi.stubEnv('TEST_PGDATABASE', 'app_test');
  validateReleaseSource();
  expect(npm).toHaveBeenCalledTimes(2);
  for (const [, options] of vi.mocked(npm).mock.calls) {
    expect(options?.env?.TEST_PGDATABASE).toBe('app_test');
    for (const key of Object.keys(secrets)) expect(options?.env).not.toHaveProperty(key);
  }
  eas(['build:view', 'verified-build', '--json']);
  expect(vi.mocked(node).mock.calls.at(-1)![2]!.env!.EXPO_TOKEN).toBe('expo-secret');
});
