# PostgreSQL storage and migrations

[`database.ts`](../src/database.ts) defines the shared connection, pool, transaction, and exact-schema checks; [`database-cli.ts`](../src/database-cli.ts) provides explicit migration commands. Accounts use this infrastructure when enabled. Guest-only startup does not open a pool. No pool is created on module import.

| Setting | Contract |
| --- | --- |
| `PGHOST` | `127.0.0.1` by default; also accepts `postgres` on private Compose networks or an authenticated proxy socket such as `/cloudsql/PROJECT:REGION:INSTANCE` |
| `PGPORT` | Integer TCP port, default `5432` |
| `PGDATABASE`, `PGUSER`, `PGPASSWORD` | Required server-side connection values |
| `PGPOOL_MAX` | Connections per process, default `3`, range `1`–`100` |
| `PGSSLMODE` | `disable` for local/private Compose/proxy connections; direct remote TCP requires `verify-full` |
| `PGSSLROOTCERT` | Optional CA certificate path for verified TLS |
| `PGOPTIONS` | Administrator connection options; fixtures use an isolated `search_path` |

The caller owns the pool and ends it after draining HTTP work. `transaction` commits successful callbacks, rolls back failures, and always releases its connection; use the supplied client for every query in the transaction. `checkDatabase` checks reachability and the exact ordered ledger without mutating it.

## Applying schema changes

Set connection variables for the intended database and run from the repository root:

```sh
npm run db:migrate
npm run db:status
```

The commands load the repository `.env` when present. Built equivalents are `node apps/server/dist/database-cli.js migrate` / `status`, or `node server/database-cli.js migrate` / `status` in the image. Invalid configuration, unavailable databases, or incompatible histories exit nonzero without printing credentials. Build and ordinary application startup never migrate automatically.

`node-pg-migrate` uses an advisory lock, an ordering check, and a single transaction; the runner verifies the resulting ledger. Append SQL files and names to `SCHEMA_VERSIONS` together. Never rewrite an applied migration or accept an unknown future history. The committed order is:

1. `1760000000000_foundation`: establishes the ledger without feature tables.
2. `1760000000002_accounts`: private backups, browser sessions, deletion work, and indexes.

The numeric gap is intentional; no ChatGPT-storage migration is shipped. The old combined `1760000000000_initial` history is incompatible: do not rename its ledger entry or layer this schema over it. There is no automatic downgrade, data import, or database rollback. Recreate only explicitly disposable test databases.

See [service tests](../../../tests/README.md#service-tests) for isolated schemas and [deployment](../../../deploy/self-hosted/README.md) for migration gating on the shared host.
