/** @file Adapts immutable media and JSON cache records to local files or shared PostgreSQL/object storage. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Pool, type PoolClient } from 'pg';
import { transaction } from '../database';

/** Minimal whole-object storage; implementations never expose filesystem paths to clients. */
export interface ObjectStore {
  /** Read an entire object, returning null only when absent. */
  read(key: string): Promise<Buffer | null>;
  /** Atomically replace one complete object. */
  write(key: string, value: Buffer): Promise<void>;
  /** Remove a no-longer-owned object; missing objects count as success. */
  remove(key: string): Promise<void>;
}
/** Namespaced cache used by existing content services; JSON metadata and binary assets have separate durability. */
export interface CacheStore {
  readonly shared: boolean;
  /** Read bytes or throw ENOENT for compatibility with cache-miss handling. */
  read(key: string): Promise<Buffer>;
  /** Commit an entire JSON record or immutable media object. */
  write(key: string, value: Buffer | string): Promise<void>;
  /** Enumerate record names, excluding binary objects. */
  list(): Promise<string[]>;
}
function valid(key: string) {
  if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(key) || key.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid storage key.');
  return key;
}
function absent(): never { throw Object.assign(new Error('Object not found.'), { code: 'ENOENT' }); }

/** Stores local media through same-directory atomic replacement; the caller owns the root directory. */
export class FileObjects implements ObjectStore {
  /** Select an application-owned data directory. */
  constructor(private root: string) {}
  /** Return a complete object; propagate permission and I/O failures. */
  async read(key: string) {
    try { return await readFile(join(this.root, valid(key))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  /** Publish bytes only after a complete temporary file is written. */
  async write(key: string, value: Buffer) {
    const path = join(this.root, valid(key)); await mkdir(dirname(path), { recursive: true });
    const temporary = path + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, value); await rename(temporary, path);
  }
  /** Delete exactly the validated object, without removing directories. */
  async remove(key: string) { await rm(join(this.root, valid(key)), { force: true }); }
}

/** Keeps isolated unit fixtures and older local cache directories usable without a database. */
export class FileCache implements CacheStore {
  readonly shared = false;
  private objects: FileObjects;
  /** Select the dedicated cache directory. */
  constructor(private root: string) { this.objects = new FileObjects(root); }
  /** Read a cache record or report a missing entry. */
  async read(key: string) { return await this.objects.read(key) ?? absent(); }
  /** Atomically persist metadata or bytes. */
  async write(key: string, value: Buffer | string) { await this.objects.write(key, Buffer.from(value)); }
  /** List the cache after creating its directory if needed. */
  async list() { await mkdir(this.root, { recursive: true }); return readdir(this.root); }
}

/** Stores JSON in PostgreSQL and media in the selected object store, optionally granting an executing account access. */
export class DatabaseCache implements CacheStore {
  readonly shared = true;
  /** Inject shared resources; account is set only by trusted job execution, never by a download route. */
  constructor(private pool: Pool, private objects: ObjectStore, private namespace: string, private account?: string, private publicMedia = false) { valid(namespace); }
  private recordNamespace() { return this.account ? this.namespace + '/owner-' + this.account : this.namespace; }
  private async grant(db: PoolClient, key: string) {
    await db.query('INSERT INTO media_objects(namespace,key,public) VALUES($1,$2,$3) ON CONFLICT(namespace,key) DO UPDATE SET public=media_objects.public OR EXCLUDED.public', [this.namespace, key, this.publicMedia]);
    if (this.account) await db.query('INSERT INTO media_grants VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [this.namespace, key, this.account]);
  }
  /** Read shared records or immutable media; successful worker reads authorize reuse for its account. */
  async read(key: string) {
    valid(key);
    if (key.endsWith('.json')) {
      const found = await this.pool.query('SELECT value FROM service_records WHERE namespace=$1 AND key=$2', [this.recordNamespace(), key]);
      return found.rows[0] ? Buffer.from(JSON.stringify(found.rows[0].value)) : absent();
    }
    if (!this.account && !this.publicMedia) return await this.objects.read(this.namespace + '/' + key) ?? absent();
    return transaction(this.pool, async db => {
      await this.grant(db, key);
      return await this.objects.read(this.namespace + '/' + key) ?? absent();
    });
  }
  /** Persist bytes before granting access, or atomically upsert a JSON record. */
  async write(key: string, value: Buffer | string) {
    valid(key);
    if (key.endsWith('.json')) {
      const parsed = JSON.parse(value.toString());
      await this.pool.query('INSERT INTO service_records(namespace,key,value,account_id) VALUES($1,$2,$3,$4) ON CONFLICT(namespace,key) DO UPDATE SET value=EXCLUDED.value', [this.recordNamespace(), key, JSON.stringify(parsed), this.account ?? null]);
      // Only GenericContent's closed-vocabulary sanitizer can write this shared namespace.
      if (this.namespace === 'generic-v1') {
        const pictures = [parsed.picture, ...(parsed.pictures ?? []).map((item: { picture?: { assetId?: string } }) => item.picture)];
        for (const picture of pictures) if (picture?.assetId) await this.pool.query("UPDATE media_objects SET public=true WHERE namespace='pictures' AND key=$1", [picture.assetId + '.png']);
      }
    } else {
      await transaction(this.pool, async db => { await this.grant(db, key); await this.objects.write(this.namespace + '/' + key, Buffer.from(value)); });
    }
  }
  /** Read current record names rather than caching another process's state. */
  async list() { return (await this.pool.query('SELECT key FROM service_records WHERE namespace=$1 ORDER BY key', [this.recordNamespace()])).rows.map(row => row.key as string); }
}

/** Adapt legacy directory callers while runtime services inject shared cache storage. */
export function cacheStore(value: string | CacheStore): CacheStore { return typeof value === 'string' ? new FileCache(value) : value; }

/** Verify a public catalog grant or an exact owner grant before a media download. */
export async function canReadMedia(pool: Pool, namespace: string, key: string, account?: string) {
  const found = await pool.query('SELECT 1 FROM media_objects m WHERE namespace=$1 AND key=$2 AND (public OR EXISTS(SELECT 1 FROM media_grants g WHERE g.namespace=m.namespace AND g.key=m.key AND g.account_id=$3))', [namespace, key, account ?? null]);
  return Boolean(found.rowCount);
}

/** Delete a bounded set of private media with no surviving owner while excluding concurrent grants. */
export async function pruneMedia(pool: Pool, objects: ObjectStore) {
  for (let count = 0; count < 50; count++) {
    const removed = await transaction(pool, async db => {
      const row = (await db.query('SELECT m.* FROM media_objects m WHERE NOT public AND NOT EXISTS(SELECT 1 FROM media_grants g WHERE g.namespace=m.namespace AND g.key=m.key) LIMIT 1 FOR UPDATE OF m SKIP LOCKED')).rows[0];
      if (!row) return false;
      await objects.remove(row.namespace + '/' + row.key);
      await db.query('DELETE FROM media_objects WHERE namespace=$1 AND key=$2', [row.namespace, row.key]); return true;
    });
    if (!removed) break;
  }
}
