/** @file Owns PostgreSQL job admission, global execution claims, durable dispatch, cancellation, and safe interruption. */
import { createHash, randomUUID } from 'node:crypto';
import { type Pool } from 'pg';
import { transaction } from '../database';
import { AccountError } from '../accounts/store';

export type JobKind = 'proposal' | 'translation' | 'analysis' | 'review' | 'speech' | 'picture';
export type JobState = 'queued' | 'working' | 'complete' | 'error' | 'cancelled' | 'interrupted';
export type Job = { id: string; account_id: string; kind: JobKind; input: unknown; state: JobState; result: unknown; error: string | null; claim: string | null; cancel_requested: boolean };
export type JobView = Pick<Job, 'id' | 'kind' | 'state' | 'result' | 'error'> & { draftId?: string; tileId?: string };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const view = ({ id, kind, state, result, error, input }: Job): JobView => ({ id, kind, state, result, error, ...(kind === 'picture' ? { draftId: (input as { draftId: string }).draftId, tileId: (input as { tileId: string }).tileId } : {}) });

/** Provides one execution protocol for polling workers and Cloud Tasks, with a caller-owned pool. */
export class Jobs {
  /** Configure admission without storing provider credentials in job records. */
  constructor(private pool: Pool, private enabled = true) {}
  /** Admit one immutable request identity, with durable per-account rate and outstanding-work limits. */
  async submit(account: string, id: string, kind: JobKind, input: unknown) {
    if (!uuid.test(id)) throw new AccountError('Provide a valid request identifier.', 400);
    const fingerprint = createHash('sha256').update(JSON.stringify({ kind, input })).digest('hex');
    return transaction(this.pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['ai-id:' + id]);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['ai-owner:' + account]);
      const previous = (await db.query<Job>('SELECT * FROM ai_jobs WHERE id=$1', [id])).rows[0];
      if (previous) {
        if (previous.account_id !== account) throw new AccountError('Job unavailable.', 404);
        if ((previous as Job & { fingerprint: string }).fingerprint !== fingerprint) throw new AccountError('This request identifier was already used for different content.', 409);
        return view(previous);
      }
      if (!this.enabled) throw new AccountError('AI is unavailable. Your boards and device speech remain available.', 503);
      const counts = (await db.query("SELECT count(*) FILTER(WHERE created_at>now()-interval '1 minute') AS recent,count(*) FILTER(WHERE state IN ('queued','working')) AS outstanding FROM ai_jobs WHERE account_id=$1", [account])).rows[0];
      if (Number(counts.recent) >= 30 || Number(counts.outstanding) >= 2) throw new AccountError('AI work is busy. Wait for your current work to finish.', 429);
      const cancelled = Boolean((await db.query('SELECT 1 FROM ai_cancellations WHERE id=$1 AND account_id=$2', [id, account])).rowCount);
      const inserted = await db.query<Job>('INSERT INTO ai_jobs(id,account_id,kind,fingerprint,input,state,cancel_requested) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [id, account, kind, fingerprint, JSON.stringify(input), cancelled ? 'cancelled' : 'queued', cancelled]);
      return view(inserted.rows[0]);
    });
  }
  /** Read an owner's job without revealing another owner's identifiers or input. */
  async get(account: string, id: string): Promise<JobView | null> {
    if (!uuid.test(id)) return null;
    const row = (await this.pool.query<Job>('SELECT * FROM ai_jobs WHERE id=$1 AND account_id=$2', [id, account])).rows[0];
    return row ? view(row) : null;
  }
  /** Cancel queued/running work and retain owner-bound intent when cancellation arrives before submission. */
  async cancel(account: string, id: string) {
    if (!uuid.test(id)) return null;
    await transaction(this.pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['ai-id:' + id]);
      await db.query('INSERT INTO ai_cancellations VALUES($1,$2) ON CONFLICT DO NOTHING', [id, account]);
      await db.query("UPDATE ai_jobs SET cancel_requested=true,state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END WHERE id=$1 AND account_id=$2 AND state IN ('queued','working')", [id, account]);
    });
    return this.get(account, id);
  }
  /** Claim at most two jobs globally; concurrent notification delivery cannot claim the same operation. */
  async claim(id?: string): Promise<Job | null> {
    if (!this.enabled || (id && !uuid.test(id))) return null;
    return transaction(this.pool, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('little-say-ai-execution',0))");
      if (Number((await db.query("SELECT count(*) FROM ai_jobs WHERE state='working'")).rows[0].count) >= 2) return null;
      const row = (await db.query<Job>("SELECT j.* FROM ai_jobs j JOIN accounts a ON a.id=j.account_id WHERE j.state='queued' AND NOT j.cancel_requested AND NOT a.deleting AND ($1::uuid IS NULL OR j.id=$1) ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED", [id ?? null])).rows[0];
      if (!row) return null;
      return (await db.query<Job>("UPDATE ai_jobs SET state='working',claim=$2,heartbeat=now() WHERE id=$1 RETURNING *", [row.id, randomUUID()])).rows[0];
    });
  }
  /** Renew an execution claim and report cancellation/deletion; expired claims can never publish results. */
  async heartbeat(job: Job) {
    const row = (await this.pool.query("UPDATE ai_jobs j SET heartbeat=now() FROM accounts a WHERE j.id=$1 AND j.claim=$2 AND j.state='working' AND a.id=j.account_id RETURNING j.cancel_requested,a.deleting", [job.id, job.claim])).rows[0];
    return Boolean(row && !row.cancel_requested && !row.deleting);
  }
  /** Publish a partial result while a worker continues bounded picture preparation. */
  async progress(job: Job, result: unknown) {
    await this.pool.query("UPDATE ai_jobs SET result=$3 WHERE id=$1 AND claim=$2 AND state='working' AND NOT cancel_requested", [job.id, job.claim, JSON.stringify(result)]);
  }
  /** Finish only a current claim; cancelled work never replaces an existing client draft. */
  async finish(job: Job, result: unknown, failed = false) {
    await this.pool.query("UPDATE ai_jobs SET state=CASE WHEN cancel_requested THEN 'cancelled' WHEN $4 THEN 'interrupted' ELSE 'complete' END,result=CASE WHEN cancel_requested OR $4 THEN NULL ELSE $3::jsonb END,error=CASE WHEN $4 THEN 'AI work could not finish. Retry explicitly when ready.' ELSE NULL END WHERE id=$1 AND claim=$2 AND state='working'", [job.id, job.claim, JSON.stringify(result ?? null), failed]);
  }
  /** Mark lost worker claims interrupted instead of automatically repeating uncertain paid calls. */
  async reconcile() {
    await this.pool.query("UPDATE ai_jobs SET state=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'interrupted' END,error='Work was interrupted. Start a new request to try again.',result=NULL WHERE state='working' AND heartbeat<now()-interval '90 seconds'");
    await this.pool.query("UPDATE ai_jobs j SET state='cancelled',cancel_requested=true FROM accounts a WHERE a.id=j.account_id AND a.deleting AND j.state='queued'");
  }
  /** Retry durable queued notifications after an enqueue failure or delivery timeout. */
  async dispatch(send: (id: string) => Promise<void>) {
    const rows = (await this.pool.query("SELECT id FROM ai_jobs WHERE state='queued' AND (dispatched_at IS NULL OR dispatched_at<now()-interval '5 minutes') ORDER BY created_at LIMIT 100")).rows;
    for (const row of rows) {
      await send(row.id);
      await this.pool.query('UPDATE ai_jobs SET dispatched_at=now() WHERE id=$1', [row.id]);
    }
  }
  /** Record local polling availability without claiming cloud workers must remain warm. */
  async workerSeen(id: string) { await this.pool.query('INSERT INTO worker_heartbeats(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET seen_at=now()', [id]); }
}
