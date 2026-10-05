/** @file Ensures destructive fixture setup requires an explicitly named test database and never falls back to application credentials. */
import { afterEach, expect, it, vi } from 'vitest';
import pg from 'pg';
import { testDatabase } from './postgres-fixture';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
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

it('drains both pools when schema creation fails without dropping an unowned schema', async () => {
  vi.stubEnv('TEST_PGDATABASE', 'little_say_test');
  vi.stubEnv('TEST_PGPASSWORD', 'test-only');
  const failure = new Error('permission denied for database little_say_test');
  const query = vi.spyOn(pg.Pool.prototype, 'query').mockRejectedValue(failure);
  const end = vi.spyOn(pg.Pool.prototype, 'end').mockResolvedValue();
  await expect(testDatabase()).rejects.toBe(failure);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toMatch(/^CREATE SCHEMA test_[a-f0-9]{32}$/);
  expect(end).toHaveBeenCalledTimes(2);
  expect(new Set(end.mock.contexts).size).toBe(2);
});
