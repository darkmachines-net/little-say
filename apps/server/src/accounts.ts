/** @file Stores Firebase-owned private backups in Postgres with atomic quota, revision, and deletion boundaries. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { type Pool, type PoolClient } from 'pg';
import { type Account, type SyncSnapshot, mergeAssets, syncSnapshotSchema } from '@little-say/core';
import { transaction } from './database';

export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
export const MAX_ACCOUNT_BYTES = 256 * 1024 * 1024;
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export type Identity = { project: string; uid: string; email: string | null; displayName: string | null; emailVerified: boolean; providers: string[]; authTime: number; expires: number };
type Row = { id: string; email: string | null; display_name: string | null; email_verified: boolean; providers: string[]; deleting?: boolean };
const publicAccount = (row: Row): Account => ({ id: row.id, email: row.email, displayName: row.display_name, emailVerified: row.email_verified, providers: row.providers, ...(row.deleting ? { deletionPending: true } : {}) });

/** An expected failure safe to show without exposing stored data or infrastructure. */
export class AccountError extends Error {
  /** Attach an HTTP status to a sanitized account failure. */
  constructor(message: string, readonly statusCode: number) { super(message); }
}

/** Uses a shared pool owned by the server; this repository never closes it. */
export class Accounts {
  /** Inject the server-owned pool and an optional smaller quota for integration fixtures. */
  constructor(private pool: Pool, private quota = MAX_ACCOUNT_BYTES) {}

  /** Provision only after explicit sign-in; Firebase project/UID is the sole identity key. */
  async provision(identity: Identity): Promise<Account> {
    return transaction(this.pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [identity.project + ':' + identity.uid]);
      const deletion = await db.query('SELECT apple_pending FROM account_deletions WHERE firebase_project=$1 AND firebase_uid=$2', [identity.project, identity.uid]);
      if (deletion.rowCount) {
        if (deletion.rows[0].apple_pending) {
          const pending = await db.query<Row>('SELECT * FROM accounts WHERE firebase_project=$1 AND firebase_uid=$2 AND deleting', [identity.project, identity.uid]);
          if (pending.rows[0]) return publicAccount(pending.rows[0]);
        }
        throw new AccountError('This account is being deleted or has been deleted.', 410);
      }
      const result = await db.query<Row>(`INSERT INTO accounts(id,firebase_project,firebase_uid,email,display_name,email_verified,providers)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(firebase_project,firebase_uid) DO UPDATE SET
        email=EXCLUDED.email,display_name=EXCLUDED.display_name,email_verified=EXCLUDED.email_verified,providers=EXCLUDED.providers RETURNING *`,
      [randomUUID(), identity.project, identity.uid, identity.email, identity.displayName, identity.emailVerified, JSON.stringify(identity.providers)]);
      const account = publicAccount(result.rows[0]);
      await db.query('INSERT INTO account_snapshots(account_id) VALUES($1) ON CONFLICT DO NOTHING', [account.id]);
      return account;
    });
  }

  /** Resolve an enrolled identity; allowDeleting is reserved for fresh proof resuming a deletion request. */
  async find(identity: Identity, allowDeleting = false): Promise<Account> {
    const result = await this.pool.query<Row & { deleting: boolean }>('SELECT * FROM accounts WHERE firebase_project=$1 AND firebase_uid=$2', [identity.project, identity.uid]);
    if (!result.rows[0]) throw new AccountError('Sign in again to sync. Your local boards are still available.', 401);
    if (result.rows[0].deleting && !allowDeleting) throw new AccountError('Account deletion is pending. If Apple confirmation was interrupted, retry Delete account.', 410);
    return { ...publicAccount(result.rows[0]), emailVerified: identity.emailVerified, providers: identity.providers };
  }

  private async lock(db: PoolClient, id: string) {
    if (!(await db.query('SELECT id FROM accounts WHERE id=$1 AND NOT deleting FOR UPDATE', [id])).rowCount) throw new AccountError('Sign in again to sync.', 401);
  }

  /** Bind a Firebase cookie to a unique browser login, even when Firebase mints identical JWTs. */
  async issueCookie(account: Account, token: string, expires: number) {
    const device = randomBytes(32).toString('hex');
    await this.pool.query('INSERT INTO browser_sessions VALUES($1,$2,$3,to_timestamp($4))', [digest(device), account.id, digest(token), expires]);
    return device + '.' + token;
  }

  /** Verify the issued device binding before Firebase verification; changing the prefix cannot bypass logout. */
  async checkCookie(cookie: string) {
    const separator = cookie.indexOf('.'), device = cookie.slice(0, separator), token = cookie.slice(separator + 1);
    if (!/^[a-f0-9]{64}$/.test(device) || !(await this.pool.query('SELECT 1 FROM browser_sessions JOIN accounts ON accounts.id=account_id WHERE hash=$1 AND token_hash=$2 AND expires>now()', [digest(device), digest(token)])).rowCount) throw new AccountError('Sign in again to sync.', 401);
    if ((await this.pool.query('SELECT 1 FROM revoked_browser_sessions WHERE hash=$1 AND expires>now()', [digest(cookie)])).rowCount) throw new AccountError('Sign in again to sync.', 401);
    return token;
  }

  /** Revoke this browser cookie without revoking other Firebase devices. */
  async logout(cookie: string, expires: number) {
    await this.pool.query('INSERT INTO revoked_browser_sessions VALUES($1,to_timestamp($2)) ON CONFLICT DO NOTHING', [digest(cookie), expires]);
    await this.pool.query('DELETE FROM browser_sessions WHERE hash=$1', [digest(cookie.split('.')[0])]);
  }

  /** Return the latest acknowledged snapshot; a deleting account cannot read or publish backups. */
  async snapshot(account: Account): Promise<SyncSnapshot> {
    const result = await this.pool.query('SELECT revision,boards,assets FROM account_snapshots JOIN accounts ON accounts.id=account_id WHERE account_id=$1 AND NOT deleting', [account.id]);
    if (!result.rows[0]) throw new AccountError('Sign in again to sync.', 401);
    return syncSnapshotSchema.parse(result.rows[0]);
  }

  /** Serialize uploads per owner so duplicate uploads and concurrent quota checks are safe. */
  async putAsset(account: Account, hash: string, bytes: Buffer) {
    if (!bytes.length || bytes.length > MAX_ASSET_BYTES || digest(bytes) !== hash) throw new AccountError('The asset is too large or failed its integrity check.', 400);
    await transaction(this.pool, async db => {
      await this.lock(db, account.id);
      if ((await db.query('SELECT 1 FROM account_assets WHERE account_id=$1 AND hash=$2', [account.id, hash])).rowCount) return;
      const used = await db.query('SELECT COALESCE(SUM(octet_length(bytes)),0) AS size FROM account_assets WHERE account_id=$1', [account.id]);
      if (Number(used.rows[0].size) + bytes.length > this.quota) throw new AccountError('This account has reached its 256 MB backup limit.', 413);
      await db.query('INSERT INTO account_assets VALUES($1,$2,$3)', [account.id, hash, bytes]);
    });
  }

  /** Read owner-scoped immutable bytes, including pending uploads needed for retries. */
  async asset(account: Account, hash: string): Promise<Buffer | null> {
    const result = await this.pool.query('SELECT bytes FROM account_assets JOIN accounts ON accounts.id=account_id WHERE account_id=$1 AND hash=$2 AND NOT deleting', [account.id, hash]);
    return result.rows[0]?.bytes ?? null;
  }

  /** Commit a complete backup only at the supplied revision, under the same owner lock as uploads. */
  async save(account: Account, input: SyncSnapshot): Promise<SyncSnapshot> {
    const snapshot = syncSnapshotSchema.parse(input);
    return transaction(this.pool, async db => {
      await this.lock(db, account.id);
      const previous = await db.query('SELECT revision FROM account_snapshots WHERE account_id=$1', [account.id]);
      if (previous.rows[0].revision !== snapshot.revision) throw new AccountError('Another device just synced. Please retry.', 409);
      try { mergeAssets(snapshot.boards, [], [], snapshot.assets); }
      catch { throw new AccountError('The backup is missing a board picture.', 400); }
      const hashes = [...new Set(snapshot.assets.map(asset => asset.hash))];
      const found = await db.query('SELECT hash FROM account_assets WHERE account_id=$1 AND hash=ANY($2::text[])', [account.id, hashes]);
      if (found.rowCount !== hashes.length) throw new AccountError('Finish uploading the backup assets before saving.', 400);
      await db.query('UPDATE account_snapshots SET revision=revision+1,boards=$2,assets=$3 WHERE account_id=$1', [account.id, JSON.stringify(snapshot.boards), JSON.stringify(snapshot.assets)]);
      return { ...snapshot, revision: snapshot.revision + 1 };
    });
  }

  /** Durably block backups before external work; Apple-gated intents require fresh revocation before queueing. */
  async requestDeletion(account: Account, identity: Identity, applePending = false) {
    await transaction(this.pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [identity.project + ':' + identity.uid]);
      if (!(await db.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [account.id])).rowCount) throw new AccountError('Account is already deleted.', 410);
      await db.query('UPDATE accounts SET deleting=true WHERE id=$1', [account.id]);
      await db.query('INSERT INTO account_deletions(firebase_project,firebase_uid,account_id,apple_pending) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [identity.project, identity.uid, account.id, applePending]);
    });
  }

  /** Release durable deletion work only after Apple authorization has been revoked, if required. */
  async confirmDeletion(identity: Identity) {
    await this.pool.query('UPDATE account_deletions SET apple_pending=false WHERE firebase_project=$1 AND firebase_uid=$2', [identity.project, identity.uid]);
  }

  /** Retry a bounded batch of durable deletions; failures remain blocked and retry after one minute. */
  async processDeletions(project: string, removeIdentity: (uid: string) => Promise<void>) {
    await this.pool.query('DELETE FROM revoked_browser_sessions WHERE expires<=now()');
    await this.pool.query('DELETE FROM browser_sessions WHERE expires<=now()');
    for (let count = 0; count < 10; count++) {
      const found = await transaction(this.pool, async db => {
        const result = await db.query('SELECT * FROM account_deletions WHERE firebase_project=$1 AND NOT completed AND NOT apple_pending AND retry_after<=now() ORDER BY retry_after LIMIT 1 FOR UPDATE SKIP LOCKED', [project]);
        const row = result.rows[0]; if (!row) return false;
        try { await removeIdentity(row.firebase_uid); }
        catch { await db.query("UPDATE account_deletions SET retry_after=now()+interval '1 minute' WHERE firebase_project=$1 AND firebase_uid=$2", [project, row.firebase_uid]); return true; }
        await db.query('DELETE FROM accounts WHERE id=$1', [row.account_id]);
        await db.query('UPDATE account_deletions SET completed=true WHERE firebase_project=$1 AND firebase_uid=$2', [project, row.firebase_uid]);
        return true;
      });
      if (!found) break;
    }
  }
}
