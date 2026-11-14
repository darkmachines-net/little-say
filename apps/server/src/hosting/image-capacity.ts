/** @file Allocates bounded image generation slots across worker processes and accounts using live job claims. */

import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { type Pool } from 'pg';
import { transaction } from '../database';
import { type Job } from './jobs';
import { AI_CLAIM_EXPIRY_SECONDS, type AiLimits } from './limits';

type ImageWork = { id: string; account_id: string; granted: boolean };
const waitMs = 200;

/** Leases one slot for each paid image call without holding a database connection during the call. */
export class ImageCapacity {
  private scheduling?: Promise<Set<string>>;

  /** Share one coordinator among a worker's claims; Postgres enforces limits across all workers. */
  constructor(private pool: Pool, private limits: AiLimits) {}

  /** Wait for an eligible slot, invoke the provider once, and release the slot on failure or completion. */
  async run<T>(job: Job, signal: AbortSignal, generate: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const id = randomUUID();
    try {
      const inserted = await this.pool.query(`INSERT INTO ai_image_work(id,job_id,claim)
        SELECT $1,id,claim FROM ai_jobs WHERE id=$2 AND claim=$3 AND state='working' AND NOT cancel_requested
        AND heartbeat>=now()-make_interval(secs => $4)`, [id, job.id, job.claim, AI_CLAIM_EXPIRY_SECONDS]);
      if (!inserted.rowCount) throw new Error('The image job is no longer active.');
      while (!(await this.schedule()).has(id)) await wait(waitMs, undefined, { signal });
      signal.throwIfAborted();
      return await generate();
    } finally {
      // Reconciliation removes this row if the database becomes unavailable during release.
      await this.pool.query('DELETE FROM ai_image_work WHERE id=$1', [id]).catch(() => {});
    }
  }

  /** Remove tickets whose parent can no longer execute. A running cancelled call retains its slot until it settles. */
  async reconcile() {
    await this.pool.query(`DELETE FROM ai_image_work w USING ai_jobs j WHERE w.job_id=j.id
      AND (j.state<>'working' OR j.claim IS DISTINCT FROM w.claim OR (j.cancel_requested AND NOT w.granted))`);
  }

  private schedule() {
    // Requests within one worker share each pass. Row grants are serialized across worker processes.
    if (!this.scheduling) this.scheduling = this.grant().finally(() => { this.scheduling = undefined; });
    return this.scheduling;
  }

  private async grant() {
    return transaction(this.pool, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('little-say-ai-image-execution',0))");
      const { rows } = await db.query<ImageWork>(`SELECT w.id,j.account_id,w.granted FROM ai_image_work w JOIN ai_jobs j ON j.id=w.job_id
        WHERE j.state='working' AND j.claim=w.claim AND (w.granted OR NOT j.cancel_requested)
        AND j.heartbeat>=now()-make_interval(secs => $1)
        ORDER BY w.queued_at,w.id`, [AI_CLAIM_EXPIRY_SECONDS]);
      const active = new Set<string>(), byOwner = new Map<string, number>();
      const waiting: ImageWork[] = [];
      for (const row of rows) {
        if (row.granted) {
          active.add(row.id);
          byOwner.set(row.account_id, (byOwner.get(row.account_id) ?? 0) + 1);
        } else waiting.push(row);
      }
      const granted: string[] = [];
      while (active.size + granted.length < this.limits.serviceImageConcurrency) {
        // Give newly competing accounts the next free slot, then break ties in queue order.
        let fewest = this.limits.accountImageConcurrency;
        let next = -1;
        for (const [index, row] of waiting.entries()) {
          const count = byOwner.get(row.account_id) ?? 0;
          if (count < fewest) { fewest = count; next = index; }
        }
        if (next < 0) break;
        const [row] = waiting.splice(next, 1);
        granted.push(row.id);
        byOwner.set(row.account_id, fewest + 1);
      }
      if (granted.length) {
        const result = await db.query<{ id: string }>(`UPDATE ai_image_work w SET granted=true FROM ai_jobs j
          WHERE w.id=ANY($1::uuid[]) AND w.job_id=j.id AND j.state='working' AND j.claim=w.claim AND NOT j.cancel_requested
          AND j.heartbeat>=now()-make_interval(secs => $2) RETURNING w.id`, [granted, AI_CLAIM_EXPIRY_SECONDS]);
        for (const row of result.rows) active.add(row.id);
      }
      return active;
    });
  }
}
