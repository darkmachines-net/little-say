/** @file Verifies Go/native launch targets share the selected stack URLs while preserving toolkit identity and credential isolation. */
import { afterEach, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { developmentConfig } from './dev-config';
import { developmentExpo } from './dev-expo';
import { localEnvironment } from './local-services';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = developmentConfig({ DEV_API_PORT: '18788', DEV_EXPO_PORT: '18081', DEV_PG_PORT: '25432', DEV_AUTH_PORT: '19099' }, [{ name: 'Wi-Fi', address: '192.168.1.20' }]);
afterEach(() => vi.unstubAllEnvs());

it.each([false, true])('uses matching URLs and an explicit Metro port (native=%s)', native => {
  vi.stubEnv('OPENAI_API_KEY', 'server-secret'); vi.stubEnv('EXPO_PUBLIC_OLD_KEY', 'stale-secret');
  const flags = new Set(['--clear', '--web', ...(native ? ['--dev-client'] : [])]);
  const expo = developmentExpo(root, config, flags);
  expect(expo.args).toEqual(expect.arrayContaining(['--port', '18081', '--lan', '--clear', '--web', native ? '--dev-client' : '--go']));
  expect(expo.env.EXPO_PUBLIC_API_URL).toBe('http://192.168.1.20:18788');
  expect(expo.env.EXPO_PUBLIC_WEB_API_URL).toBe('http://192.168.1.20:18081');
  expect(expo.env.LITTLE_SAY_DEV_PROXY_URL).toBe(expo.env.EXPO_PUBLIC_API_URL);
  expect(JSON.stringify(expo.env)).not.toContain('secret');
  if (native) { expect(expo.env.EXPO_RELEASE_VARIANT).toBe('development'); expect(expo.env.EAS_BUILD_PROFILE).toBe('development'); }
});

it('propagates PostgreSQL and device Auth ports into the backend without accepting hosted settings', () => {
  const local = localEnvironment(root, { DEV_PG_PORT: String(config.pgPort), DEV_AUTH_PORT: String(config.authPort), PGHOST: 'hosted', FIREBASE_PROJECT_ID: 'hosted' }, config.host);
  expect(local.PGHOST).toBe('127.0.0.1'); expect(local.PGPORT).toBe('25432');
  expect(local.FIREBASE_AUTH_EMULATOR_URL).toBe('http://192.168.1.20:19099');
  expect(local.FIREBASE_AUTH_EMULATOR_HOST).toBe('192.168.1.20:19099');
  expect(local.FIREBASE_PROJECT_ID).toBe('demo-little-say');
});
