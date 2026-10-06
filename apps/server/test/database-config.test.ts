/** @file Verifies one Postgres connection contract for local TCP, Compose, Cloud SQL sockets, and verified remote TLS. */
import { expect, it } from 'vitest';
import { databaseConfig } from '../src/database';
const credentials = { PGDATABASE: 'example', PGUSER: 'app', PGPASSWORD: 'not-a-secret-test-value' };
it('defaults to a three-connection pool and supports local/Compose/socket hosts', () => {
  for (const PGHOST of ['127.0.0.1', 'postgres', '/cloudsql/project:region:instance']) {
    expect(databaseConfig({ ...credentials, PGHOST })).toMatchObject({ host: PGHOST, max: 3, ssl: false });
  }
});
it('rejects insecure direct remote TCP and validates required settings', () => {
  expect(databaseConfig({ ...credentials, PGHOST: 'db.example.test' }).ssl).toEqual({ rejectUnauthorized: true });
  expect(() => databaseConfig({ ...credentials, PGHOST: 'db.example.test', PGSSLMODE: 'disable' })).toThrow();
  for (const env of [{}, { ...credentials, PGPORT: 'zero' }, { ...credentials, PGPOOL_MAX: '0' }, { ...credentials, PGSSLMODE: 'require' }]) expect(() => databaseConfig(env)).toThrow();
});
