/** @file Checks only this polling container's recent heartbeat for Compose health without cloud or AI calls. */
import { createDatabase, checkDatabase } from './database';
const pool = createDatabase();
try {
  await checkDatabase(pool);
  const result = await pool.query("SELECT 1 FROM worker_heartbeats WHERE id=$1 AND seen_at>now()-interval '30 seconds'", [process.env.HOSTNAME]);
  if (!result.rowCount) process.exitCode = 1;
} catch { process.exitCode = 1; }
finally { await pool.end(); }
