/** @file Stores private account backups, salted password hashes, and revocable sessions in a durable SQLite database. */

import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type Account, type SyncSnapshot, mergeAssets, syncSnapshotSchema } from '@little-say/core';

const SESSION_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_ACCOUNT_BYTES = 256 * 1024 * 1024;
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const empty: SyncSnapshot = { revision: 0, boards: [], assets: [] };

/** A safe account error whose status and message can be shown without exposing stored data. */
export class AccountError extends Error {
  /** Attach an HTTP status to an expected authentication, quota, or revision failure. */
  constructor(message: string, readonly statusCode: number) { super(message); }
}

async function passwordHash(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}

/** Owns one database connection. Call close after the server stops accepting requests. */
export class Accounts {
  private db: DatabaseSync;
  private hashing = 0;
  /** Create or open a private backup database; WAL plus FULL durability protects acknowledged syncs. */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password BLOB NOT NULL, recovery TEXT NOT NULL, snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS assets (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, hash TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(account_id, hash));`);
  }
  private async hash(password: string, salt: string) {
    if (this.hashing >= 2) throw new AccountError('Account service is busy. Try again shortly.', 429);
    this.hashing++;
    try { return await passwordHash(password, salt); } finally { this.hashing--; }
  }
  private session(account: Account) {
    const token = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), account.id, Date.now() + SESSION_MS);
    return { account, token };
  }
  /** Create an account and a session; reveal the password-recovery secret only in this response. */
  async register(username: string, password: string) {
    const salt = randomBytes(16).toString('hex'), recoveryCode = randomBytes(24).toString('hex');
    const hash = await this.hash(password, salt);
    const account = { id: randomUUID(), username };
    if (this.db.prepare('SELECT id FROM accounts WHERE username = ?').get(username)) throw new AccountError('That account name is unavailable. Choose another or sign in.', 409);
    this.db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?, ?, ?)').run(account.id, username, salt, hash, digest(recoveryCode), JSON.stringify(empty));
    return { ...this.session(account), recoveryCode };
  }
  /** Verify a password with bounded asynchronous scrypt work, returning a new revocable session. */
  async login(username: string, password: string) {
    const row = this.db.prepare('SELECT id, salt, password FROM accounts WHERE username = ?').get(username);
    const hash = await this.hash(password, row?.salt as string ?? 'unregistered-account');
    if (!row || !timingSafeEqual(hash, row.password as Uint8Array)) throw new AccountError('Account name or password is incorrect.', 401);
    // Password resets can finish while hashing is in flight. Do not mint a session for old credentials.
    const current = this.db.prepare('SELECT password FROM accounts WHERE id = ?').get(row.id!);
    if (!current || !timingSafeEqual(hash, current.password as Uint8Array)) throw new AccountError('Account name or password is incorrect.', 401);
    return this.session({ id: row.id as string, username });
  }
  /** Reset a forgotten password using the saved recovery code, rotate that code, and revoke every session. */
  async recover(username: string, password: string, recoveryCode: string) {
    const salt = randomBytes(16).toString('hex');
    const hash = await this.hash(password, salt);
    const row = this.db.prepare('SELECT id, recovery FROM accounts WHERE username = ?').get(username);
    if (!row || row.recovery !== digest(recoveryCode)) throw new AccountError('Account name or recovery code is incorrect.', 401);
    const replacement = randomBytes(24).toString('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE accounts SET salt = ?, password = ?, recovery = ? WHERE id = ?').run(salt, hash, digest(replacement), row.id!);
      this.db.prepare('DELETE FROM sessions WHERE account_id = ?').run(row.id!);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { ...this.session({ id: row.id as string, username }), recoveryCode: replacement };
  }
  /** Resolve an unexpired opaque token; no account or backup access is possible without a valid session. */
  authenticate(token: string): Account {
    const row = this.db.prepare('SELECT accounts.id, username FROM sessions JOIN accounts ON accounts.id = sessions.account_id WHERE hash = ? AND expires > ?').get(digest(token), Date.now());
    if (!row) throw new AccountError('Sign in again to sync. Your local boards are still available.', 401);
    return { id: row.id as string, username: row.username as string };
  }
  /** Invalidate only this device's session. */
  logout(token: string) { this.db.prepare('DELETE FROM sessions WHERE hash = ?').run(digest(token)); }
  /** Permanently delete this account, its sessions, and its private backup assets. */
  delete(account: Account) { this.db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id); }
  /** Return the most recently committed complete backup. */
  snapshot(account: Account): SyncSnapshot {
    const row = this.db.prepare('SELECT snapshot FROM accounts WHERE id = ?').get(account.id);
    if (!row) throw new AccountError('Sign in again to sync.', 401);
    return syncSnapshotSchema.parse(JSON.parse(row.snapshot as string));
  }
  /** Store a content-addressed asset privately, limiting individual files and total account storage. */
  putAsset(account: Account, hash: string, bytes: Buffer) {
    if (!bytes.length || bytes.length > MAX_ASSET_BYTES || digest(bytes) !== hash) throw new AccountError('The asset is too large or failed its integrity check.', 400);
    if (this.db.prepare('SELECT 1 FROM assets WHERE account_id = ? AND hash = ?').get(account.id, hash)) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const used = this.db.prepare('SELECT COALESCE(SUM(length(bytes)), 0) AS size FROM assets WHERE account_id = ?').get(account.id)!.size as number;
      if (used + bytes.length > MAX_ACCOUNT_BYTES) throw new AccountError('This account has reached its 256 MB backup limit.', 413);
      this.db.prepare('INSERT INTO assets VALUES (?, ?, ?)').run(account.id, hash, bytes);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  /** Read bytes only from the authenticated account, including pending uploads for retry safety. */
  asset(account: Account, hash: string): Buffer | null {
    const row = this.db.prepare('SELECT bytes FROM assets WHERE account_id = ? AND hash = ?').get(account.id, hash);
    return row ? Buffer.from(row.bytes as Uint8Array) : null;
  }
  /** Atomically publish a complete snapshot only if its revision is current and every asset is durable. */
  save(account: Account, input: SyncSnapshot): SyncSnapshot {
    const snapshot = syncSnapshotSchema.parse(input);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.snapshot(account);
      if (previous.revision !== snapshot.revision) throw new AccountError('Another device just synced. Please retry.', 409);
      try { mergeAssets(snapshot.boards, [], [], snapshot.assets); }
      catch { throw new AccountError('The backup is missing a board picture.', 400); }
      for (const asset of snapshot.assets) if (!this.db.prepare('SELECT 1 FROM assets WHERE account_id = ? AND hash = ?').get(account.id, asset.hash)) throw new AccountError('Finish uploading the backup assets before saving.', 400);
      const next = { ...snapshot, revision: snapshot.revision + 1 };
      this.db.prepare('UPDATE accounts SET snapshot = ? WHERE id = ?').run(JSON.stringify(next), account.id);
      this.db.exec('COMMIT');
      return next;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  /** Close SQLite after active requests have finished. */
  close() { this.db.close(); }
}
