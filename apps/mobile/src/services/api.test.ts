/** @file Protects account credentials from development backend overrides without changing ordinary API routing. */
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: {} } }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

it('pins account credentials to the consented server while ordinary requests follow the development backend', async () => {
  vi.stubGlobal('__DEV__', true);
  vi.stubGlobal('window', { location: { origin: 'https://development.example' } });
  vi.stubEnv('EXPO_PUBLIC_WEB_API_URL', 'https://development.example');
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal('fetch', fetch);
  const { apiFetch } = await import('./api');
  await apiFetch('https://consented.example', '/api/account/session', { headers: { Authorization: 'Bearer synthetic-token' } }, undefined, true);
  expect(fetch).toHaveBeenLastCalledWith('https://consented.example/api/account/session', expect.objectContaining({ headers: { 'X-Little-Say': '1', Authorization: 'Bearer synthetic-token' } }));
  await apiFetch('https://consented.example', '/api/health');
  expect(fetch).toHaveBeenLastCalledWith('https://development.example/api/health', expect.objectContaining({ headers: { 'X-Little-Say': '1' } }));
});
