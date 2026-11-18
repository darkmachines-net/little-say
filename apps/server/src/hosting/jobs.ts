/** @file Persists job state and enforces per-account admission and worker capacity. */
import { createHash, randomUUID } from 'node:crypto';
import { type Pool } from 'pg';
import { transaction } from '../database';
import { AccountError } from '../accounts/store';
import { AI_CLAIM_EXPIRY_SECONDS, readAiLimits, type AiLimits } from './limits';
import { ImageCapacity } from './image-capacity';

export type JobKind = 'proposal' | 'translation' | 'analysis' | 'review' | 'speech' | 'picture';
type JobState = 'queued' | 'working' | 'complete' | 'error' | 'cancelled' | 'interrupted';
export type Job = { id: string; account_id: string; kind: JobKind; input: unknown; state: JobState; result: unknown; error: string | null; claim: string | null; cancel_requested: boolean };
export type JobView = Pick<Job, 'id' | 'kind' | 'state' | 'result' | 'error'> & { draftId?: string; tileId?: string };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const view = ({ id, kind, state, result, error, input }: Job): JobView => ({ id, kind, state, result, error, ...(kind === 'picture' ? { draftId: (input as { draftId: string }).draftId, tileId: (input as { tileId: string }).tileId } : {}) });

/** An admission rejection before any new job has been queued. */
export class JobAdmissionError extends AccountError {
  /** Distinguish a rolling rate limit from a full queue and provide the earliest useful retry in seconds. */
  constructor(message: string, readonly retryAfterSeconds: number, readonly reason: 'rate-limit' | 'queue-full') { super(message, 429); }
}

/** Provides one execution protocol for polling workers and Cloud Tasks, with a caller-owned pool. */
export class Jobs {
  readonly images: ImageCapacity;
  /** Use the same validated capacity settings in the API and every worker attached to this pool. */
  constructor(private pool: Pool, private enabled = true, readonly limits: AiLimits = readAiLimits({})) {
    this.images = new ImageCapacity(pool, limits);
  }
  /** Admit a board start, speech job, or other action into its own per-account rolling budget and backlog. */
  async submit(account: string, id: string, kind: JobKind, input: unknown) {
    if (!uuid.test(id)) throw new AccountError('Provide a valid request identifier.', 400);
    await this.interruptExpired(account);
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
      const category = kind === 'proposal' || kind === 'speech' ? kind : 'other';
      const rate = kind === 'proposal' ? this.limits.accountBoardStartsPerMinute : this.limits.accountJobStartsPerMinute;
      const outstanding = kind === 'proposal' ? this.limits.accountBoardOutstanding : this.limits.accountJobOutstanding;
      const counts = (await db.query<{ retry_after_seconds: number | null; outstanding: string }>(`
        SELECT ceil(extract(epoch FROM (
          (array_agg(created_at ORDER BY created_at DESC) FILTER (WHERE created_at > now()-interval '1 minute'))[$3::integer]
          + interval '1 minute' - now()
        )))::integer AS retry_after_seconds,
        count(*) FILTER (WHERE state IN ('queued','working')) AS outstanding
        FROM ai_jobs WHERE account_id=$1 AND (CASE WHEN kind IN ('proposal','speech') THEN kind ELSE 'other' END)=$2
      `, [account, category, rate])).rows[0];
      if (counts.retry_after_seconds !== null) {
        const label = kind === 'proposal' ? 'board requests' : 'AI requests';
        throw new JobAdmissionError(`Too many ${label} in the last minute. Please try again shortly.`, counts.retry_after_seconds, 'rate-limit');
      }
      if (Number(counts.outstanding) >= outstanding) {
        const message = kind === 'speech' ? 'Audio is still being prepared. Please try again shortly.'
          : kind === 'proposal' ? 'Your board requests are still in progress. Please try again shortly.'
          : 'AI work is busy. Wait for your current work to finish.';
        throw new JobAdmissionError(message, 2, 'queue-full');
      }
      const cancelled = Boolean((await db.query('SELECT 1 FROM ai_cancellations WHERE id=$1 AND account_id=$2', [id, account])).rowCount);
      const inserted = await db.query<Job>('INSERT INTO ai_jobs(id,account_id,kind,fingerprint,input,state,cancel_requested) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [id, account, kind, fingerprint, JSON.stringify(input), cancelled ? 'cancelled' : 'queued', cancelled]);
      return view(inserted.rows[0]);
    });
  }
  /** Count queued and live working jobs for one account without returning content or request identifiers. */
  async activity(account: string) {
    const { rows } = await this.pool.query<{ category: 'boards' | 'speech' | 'other'; state: 'queued' | 'working'; count: number }>(`SELECT
      CASE WHEN kind='proposal' THEN 'boards' WHEN kind='speech' THEN 'speech' ELSE 'other' END AS category,
      state, count(*)::integer AS count
      FROM ai_jobs WHERE account_id=$1 AND (state='queued' OR (state='working' AND heartbeat>=now()-make_interval(secs => $2)))
      GROUP BY category,state`, [account, AI_CLAIM_EXPIRY_SECONDS]);
    const activity = { boards: { queued: 0, working: 0 }, speech: { queued: 0, working: 0 }, other: { queued: 0, working: 0 } };
    for (const row of rows) activity[row.category][row.state] = row.count;
    return activity;
  }
  /** Read owner-only state, settling expired worker claims even when scheduled maintenance is delayed. */
  async get(account: string, id: string): Promise<JobView | null> {
    if (!uuid.test(id)) return null;
    await this.interruptExpired(account);
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
  /** Claim within the relevant global worker budget and account board limit. Pollers prefer queued board starts. */
  async claim(id?: string): Promise<Job | null> {
    if (!this.enabled || (id && !uuid.test(id))) return null;
    await this.interruptExpired();
    return transaction(this.pool, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('little-say-ai-execution',0))");
      const { foreground, speech } = (await db.query<{ foreground: string; speech: string }>(`SELECT
        count(*) FILTER (WHERE kind<>'speech') AS foreground, count(*) FILTER (WHERE kind='speech') AS speech
        FROM ai_jobs WHERE state='working'`)).rows[0];
      const foregroundAvailable = Number(foreground) < this.limits.serviceForegroundConcurrency;
      const speechAvailable = Number(speech) < this.limits.serviceSpeechConcurrency;
      if (!foregroundAvailable && !speechAvailable) return null;
      const row = (await db.query<Job>(`SELECT j.* FROM ai_jobs j JOIN accounts a ON a.id=j.account_id
        WHERE j.state='queued' AND NOT j.cancel_requested AND NOT a.deleting AND ($1::uuid IS NULL OR j.id=$1)
        AND CASE WHEN j.kind='speech' THEN $2::boolean ELSE $3::boolean END
        AND (j.kind<>'proposal' OR (SELECT count(*) FROM ai_jobs active
          WHERE active.account_id=j.account_id AND active.kind='proposal' AND active.state='working') < $4::integer)
        AND NOT (j.kind='speech' AND EXISTS (
          SELECT 1 FROM ai_jobs running WHERE running.kind='speech' AND running.state='working'
          AND running.input->>'text'=j.input->>'text' AND running.input->>'language'=j.input->>'language'
        )) ORDER BY CASE j.kind WHEN 'proposal' THEN 0 WHEN 'speech' THEN 2 ELSE 1 END, j.created_at
        LIMIT 1 FOR UPDATE OF j SKIP LOCKED`, [id ?? null, speechAvailable, foregroundAvailable, this.limits.accountBoardConcurrency])).rows[0];
      if (!row) return null;
      return (await db.query<Job>("UPDATE ai_jobs SET state='working',claim=$2,heartbeat=now() WHERE id=$1 RETURNING *", [row.id, randomUUID()])).rows[0];
    });
  }
  /** Renew a current claim and distinguish cancellation or account deletion from loss of the claim. */
  async heartbeat(job: Job): Promise<'active' | 'cancelled' | 'lost'> {
    const row = (await this.pool.query("UPDATE ai_jobs j SET heartbeat=now() FROM accounts a WHERE j.id=$1 AND j.claim=$2 AND j.state='working' AND a.id=j.account_id RETURNING j.cancel_requested,a.deleting", [job.id, job.claim])).rows[0];
    if (!row) return 'lost';
    return row.cancel_requested || row.deleting ? 'cancelled' : 'active';
  }
  /** Publish a partial result while a worker continues bounded picture preparation. */
  async progress(job: Job, result: unknown) {
    await this.pool.query("UPDATE ai_jobs SET result=$3 WHERE id=$1 AND claim=$2 AND state='working' AND NOT cancel_requested", [job.id, job.claim, JSON.stringify(result)]);
  }
  /** Finish only a current claim; cancelled work never replaces an existing client draft. */
  async finish(job: Job, result: unknown, failed = false) {
    await this.pool.query("UPDATE ai_jobs SET state=CASE WHEN cancel_requested THEN 'cancelled' WHEN $4 THEN 'interrupted' ELSE 'complete' END,result=CASE WHEN cancel_requested OR $4 THEN NULL ELSE $3::jsonb END,error=CASE WHEN $4 THEN 'AI work could not finish. Retry explicitly when ready.' ELSE NULL END WHERE id=$1 AND claim=$2 AND state='working'", [job.id, job.claim, JSON.stringify(result ?? null), failed]);
  }
  private async interruptExpired(account?: string) {
    await this.pool.query("UPDATE ai_jobs SET state=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'interrupted' END,error='Work was interrupted. Start a new request to try again.',result=NULL WHERE state='working' AND heartbeat<now()-make_interval(secs => $2) AND ($1::uuid IS NULL OR account_id=$1)", [account ?? null, AI_CLAIM_EXPIRY_SECONDS]);
  }
  /** Settle lost worker claims without replaying paid calls and cancel queued work for deleting accounts. */
  async reconcile() {
    await this.interruptExpired();
    await this.pool.query("UPDATE ai_jobs j SET state='cancelled',cancel_requested=true FROM accounts a WHERE a.id=j.account_id AND a.deleting AND j.state='queued'");
    await this.images.reconcile();
  }
  /** Retry durable queued notifications after an enqueue failure or delivery timeout. */
  async dispatch(send: (id: string, kind: JobKind) => Promise<void>) {
    const rows = (await this.pool.query<{ id: string; kind: JobKind }>(`SELECT id,kind FROM ai_jobs WHERE state='queued'
      AND (dispatched_at IS NULL OR dispatched_at<now()-interval '5 minutes')
      ORDER BY CASE kind WHEN 'proposal' THEN 0 WHEN 'speech' THEN 2 ELSE 1 END,created_at LIMIT 100`)).rows;
    for (const row of rows) {
      await send(row.id, row.kind);
      await this.pool.query('UPDATE ai_jobs SET dispatched_at=now() WHERE id=$1', [row.id]);
    }
  }
  /** Record local polling availability without claiming cloud workers must remain warm. */
  async workerSeen(id: string) { await this.pool.query('INSERT INTO worker_heartbeats(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET seen_at=now()', [id]); }
}
