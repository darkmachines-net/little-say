/** @file Ensures destructive fixture setup requires an explicitly named test database and never falls back to application credentials. */
import { afterEach, expect, it, vi } from 'vitest';
import { testDatabase } from './postgres-fixture';

afterEach(() => vi.unstubAllEnvs());
it.each([undefined, 'little_say'])('rejects a missing or non-test database before connecting: %s', async name => {
  vi.stubEnv('PGDATABASE', 'application_database');
  vi.stubEnv('PGPASSWORD', 'application-password-not-used');
  vi.stubEnv('TEST_PGDATABASE', name);
  vi.stubEnv('TEST_PGPASSWORD', 'test-only');
  await expect(testDatabase()).rejects.toThrow('TEST_PGDATABASE ending in _test');
});
it('requires a separate test password even when application credentials exist', async () => {
  vi.stubEnv('TEST_PGDATABASE', 'little_say_test');
  vi.stubEnv('TEST_PGPASSWORD', undefined);
  vi.stubEnv('PGPASSWORD', 'application-password-not-used');
  await expect(testDatabase()).rejects.toThrow('TEST_PGPASSWORD');
});
