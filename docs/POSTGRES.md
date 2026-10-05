# Shared PostgreSQL foundation

The server package provides one PostgreSQL configuration, process-owned pool,
transaction helper, explicit migration runner and schema compatibility check for
features that need shared storage. The current application does not open a pool
or require a database at startup. Device SQLite/IndexedDB, media caches, HTTP
health, development launchers and deployment behavior retain their existing
contracts. ChatGPT owns the pool until HTTP shutdown; later account work can share that lifecycle.

## Connection and ownership

| Setting | Contract |
| --- | --- |
| `PGHOST` | Defaults to `127.0.0.1`; also accepts the private Compose host `postgres` or an authenticated proxy socket such as `/cloudsql/PROJECT:REGION:INSTANCE` |
| `PGPORT` | Integer TCP port, default `5432` |
| `PGDATABASE`, `PGUSER`, `PGPASSWORD` | Required server-side connection values |
| `PGPOOL_MAX` | Connections per process, default `3`, range `1`–`100` |
| `PGSSLMODE` | `disable` for local/private Compose/proxy connections; direct remote TCP requires `verify-full` |
| `PGSSLROOTCERT` | Optional external CA certificate path for verified TLS |
| `PGOPTIONS` | Administrator connection options; test fixtures set an isolated `search_path` |

`createDatabase` returns a pool owned by the caller. Drain requests and call
`pool.end()` during shutdown. `transaction` commits successful callbacks, rolls
back failed callbacks and always releases its checked-out connection. Callers
must use the supplied client for all work in that transaction.

No pool is created on import. `checkDatabase` checks reachability and the exact
ordered migration history; it does not mutate the database. Feature startup and
readiness routes can use this check without running migrations on every request.
Neither a real Cloud SQL connection nor TLS provider configuration is established
by this prerequisite.

## Explicit migrations

Set the connection variables for the intended database, then run from the root:

```sh
npm run db:migrate
npm run db:status
```

These commands load the repository `.env` when present. With a built server, use
`node apps/server/dist/database-cli.js migrate` or `status`. The container includes
the same commands under `server/database-cli.js` and their sibling migration
directory. Invalid configuration, unavailable databases or incompatible histories
produce a nonzero exit and a generic diagnostic without connection credentials.
No migration runs automatically during build or ordinary application startup.

Migrations use `node-pg-migrate`'s advisory lock, ordering check and single
transaction, then validate the exact resulting ledger before reporting success.
The initial `1760000000000_foundation.sql` records the foundation in
`pgmigrations` and creates no feature tables. Repeat migration runs are idempotent.
Append new migration files and their names to `SCHEMA_VERSIONS` in the same order;
never rewrite an applied migration or accept an unknown future history.

The dependency order for the existing feature continuations is:

1. Foundation: `1760000000000_foundation`.
2. ChatGPT storage: append `1760000000001_chatgpt` for its sessions, transactions
   and expiry indexes.
3. Firebase/account storage: append `1760000000002_accounts` for account, backup,
   browser-session and deletion tables and indexes.

Only the first migration ships here. Those feature tables remain owned by their
respective changes. The earlier combined `1760000000000_initial` migration is
deliberately incompatible: do not rename its ledger entry or apply this history
over it. Recreate only disposable test databases when validating the new stack.
Little Say needs no legacy account migration; no existing data is imported or
erased by this extraction. There is no automatic downgrade or rollback command,
and production rollout remains separate.

See [testing](testing.md#postgresql-foundation-tests) for real-database validation
using generated schemas inside an explicitly named disposable test database.
