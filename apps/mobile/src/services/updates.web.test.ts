/** @file Verifies Metro skips service-worker registration on arbitrary ports while production retains update discovery. */
import { afterEach, expect, it, vi } from 'vitest';
import { initializeUpdates } from './updates.web';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('skips service workers for development at any port', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  const register = vi.fn(); vi.stubGlobal('navigator', { serviceWorker: { register } });
  vi.stubGlobal('location', { port: '8123' });
  const cleanup = await initializeUpdates(vi.fn()); cleanup();
  expect(register).not.toHaveBeenCalled();
});

it('registers the production worker even on port 8081 and removes discovery listeners', async () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubGlobal('location', { port: '8081' });
  const registration = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const register = vi.fn().mockResolvedValue(registration);
  vi.stubGlobal('navigator', { serviceWorker: { register } });
  const cleanup = await initializeUpdates(vi.fn()); cleanup();
  expect(register).toHaveBeenCalledWith('/sw.js');
  expect(registration.removeEventListener).toHaveBeenCalledWith('updatefound', expect.any(Function));
});
