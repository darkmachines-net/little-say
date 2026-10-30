/** @file Uses application-default identity for private Google object storage and authenticated Cloud Tasks delivery. */
import { applicationDefault } from 'firebase-admin/app';
import { type ObjectStore } from './storage';

async function request(url: string, init: RequestInit = {}, timeout = 30000) {
  const token = await applicationDefault().getAccessToken();
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout), headers: { ...init.headers, Authorization: `Bearer ${token.access_token}` } });
  if (!response.ok && response.status !== 404 && response.status !== 409) throw new Error(`Google service request failed (${response.status}).`);
  return response;
}

/** Reads and writes complete objects through the JSON API; no filesystem mount or public bucket is required. */
export class GoogleObjects implements ObjectStore {
  /** Select the provisioned regional bucket. */
  constructor(private bucket: string) { if (!/^[a-z0-9][a-z0-9._-]+$/.test(bucket)) throw new Error('Invalid media bucket.'); }
  /** Fetch private object bytes, returning null only for absence. */
  async read(key: string) {
    const response = await request(`https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(key)}?alt=media`);
    if (!response.ok && response.status !== 404) throw new Error('Media read failed.');
    return response.status === 404 ? null : Buffer.from(await response.arrayBuffer());
  }
  /** Upload one immutable content-addressed object. */
  async write(key: string, value: Buffer) {
    const response = await request(`https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(value) });
    if (!response.ok) throw new Error('Media upload failed.');
  }
  /** Soft-delete an unowned object using the bucket's configured recovery window. */
  async remove(key: string) {
    const response = await request(`https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error('Media deletion failed.');
  }
}

/** Publishes execution notifications; PostgreSQL remains authoritative after duplicate or lost deliveries. */
export class GoogleDispatch {
  /** Queue is a full resource name; worker URL and invoking identity come from infrastructure outputs. */
  constructor(private queue: string, private worker: string, private invoker: string) {
    if (!/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/queues\/[a-z0-9-]+$/.test(queue) || new URL(worker).protocol !== 'https:' || !invoker.endsWith('.iam.gserviceaccount.com')) throw new Error('Invalid Cloud Tasks configuration.');
  }
  /** Enqueue a bounded retry-window notification without embedding prompts, credentials, or account data. */
  async send(id: string) {
    const response = await request(`https://cloudtasks.googleapis.com/v2/${this.queue}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: {
      name: `${this.queue}/tasks/job-${id}-${Math.floor(Date.now() / 300000)}`,
      dispatchDeadline: '1800s', httpRequest: { httpMethod: 'POST', url: `${this.worker}/internal/jobs/${id}`,
        oidcToken: { serviceAccountEmail: this.invoker, audience: this.worker }, headers: { 'Content-Type': 'application/json' }, body: Buffer.from('{}').toString('base64') },
    } }) }, 3000);
    if (!response.ok && response.status !== 409) throw new Error('Task dispatch failed.');
  }
}
