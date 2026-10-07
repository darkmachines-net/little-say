// src/database-cli.ts
import { config } from "dotenv";
import { resolve } from "node:path";

// src/database.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runner } from "node-pg-migrate";
var SCHEMA_VERSIONS = ["1760000000000_foundation"];
var migrations = fileURLToPath(new URL("../migrations/", import.meta.url));
function integer(value, fallback, max) {
  const number = value === void 0 ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error("Invalid Postgres port or pool size.");
  return number;
}
function databaseConfig(env = process.env) {
  const host = env.PGHOST || "127.0.0.1";
  const local = ["localhost", "127.0.0.1", "::1", "postgres"].includes(host) || host.startsWith("/");
  const sslmode = env.PGSSLMODE || (local ? "disable" : "verify-full");
  if (!["disable", "verify-full"].includes(sslmode) || !local && sslmode !== "verify-full") throw new Error("Remote Postgres requires PGSSLMODE=verify-full.");
  if (!env.PGDATABASE || !env.PGUSER || !env.PGPASSWORD) throw new Error("Set PGDATABASE, PGUSER, and PGPASSWORD for the selected Postgres database.");
  return {
    host,
    port: integer(env.PGPORT, 5432, 65535),
    database: env.PGDATABASE,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    max: integer(env.PGPOOL_MAX, 3, 100),
    connectionTimeoutMillis: 5e3,
    idleTimeoutMillis: 3e4,
    options: env.PGOPTIONS,
    ssl: sslmode === "verify-full" ? { rejectUnauthorized: true, ...env.PGSSLROOTCERT ? { ca: readFileSync(env.PGSSLROOTCERT, "utf8") } : {} } : false
  };
}
function createDatabase(env = process.env) {
  const pool = new pg.Pool(databaseConfig(env));
  pool.on("error", () => console.error("An idle Postgres connection failed. New requests will reconnect."));
  return pool;
}
async function migrateDatabase(config2, schema = "public") {
  await runner({ databaseUrl: config2, dir: migrations, schema, migrationsTable: "pgmigrations", direction: "up", singleTransaction: true, checkOrder: true, log: () => {
  } });
  const pool = new pg.Pool(config2);
  try {
    await checkDatabase(pool, schema);
  } finally {
    await pool.end();
  }
}
async function checkDatabase(pool, schema) {
  const table = schema === void 0 ? "pgmigrations" : `${pg.escapeIdentifier(schema)}.pgmigrations`;
  const result = await pool.query(`SELECT name FROM ${table} ORDER BY id`);
  if (result.rows.length !== SCHEMA_VERSIONS.length || result.rows.some((row, index) => row.name !== SCHEMA_VERSIONS[index])) throw new Error("Postgres schema is incompatible. Run db:migrate with the selected server release.");
}

// src/database-cli.ts
config({ path: resolve(process.cwd(), "../../.env"), quiet: true });
config({ quiet: true });
try {
  const command = process.argv[2];
  if (command === "migrate") {
    await migrateDatabase(databaseConfig());
    console.log("Postgres migrations applied.");
  } else if (command === "status") {
    const pool = createDatabase();
    try {
      await checkDatabase(pool);
      console.log("Postgres is reachable and its schema is compatible.");
    } finally {
      await pool.end();
    }
  } else throw new Error("Use database-cli migrate or status.");
} catch {
  console.error("Database command failed. Check Postgres configuration, availability, and the migration version. No credentials are logged.");
  process.exitCode = 1;
}
