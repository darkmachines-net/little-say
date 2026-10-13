/** @file Stores append-only release plans and operation receipts in draft GitHub Release assets, surviving runner loss. */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { assert, run, sha256, writeJson } from './common';
import { hash } from './inputs';
import type { Operation, ReleaseReceipt } from './contract';

/** Run a GitHub CLI request scoped to the current repository with captured output. */
export function gh(args: string[]): string { return run('gh', args, { capture: true }); }

/** Read every release page without truncating history; draft access requires the caller's repository push/Contents write permission. */
export function releases(): any[] {
  return JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${process.env.GITHUB_REPOSITORY}/releases?per_page=100`])).flat();
}

/** Load a JSON asset using authenticated GitHub API access, never an unauthenticated draft download URL. */
export function readAsset<T>(release: any, name: string): T | undefined {
  const asset = release?.assets.find((a: any) => a.name === name);
  if (!asset) return undefined;
  return JSON.parse(gh(['api', `repos/${process.env.GITHUB_REPOSITORY}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream']));
}

/** Download one immutable binary asset with authenticated GitHub access and verify the provider's byte digest. */
export function downloadAsset(release: any, name: string, destination: string): string {
  assert(/^[a-z0-9.-]+\.bin$/.test(name), 'Invalid binary journal asset name.');
  const asset = release?.assets.find((a: any) => a.name === name);
  assert(asset && /^sha256:[a-f0-9]{64}$/.test(asset.digest), 'Missing binary journal artifact proof.');
  gh(['release', 'download', release.tag_name, '--repo', process.env.GITHUB_REPOSITORY!, '--pattern', name, '--output', destination]);
  assert(`sha256:${sha256(destination)}` === asset.digest, 'Downloaded journal artifact differs.');
  return asset.digest;
}

export interface Retirement {
  schema: 1; runId: string; releaseId: number; source: string; reason: string;
  kind?: 'reconciled-partial'; evidenceHash?: string;
  assets: { id: number; name: string; digest: string; hash: string }[];
}

/** Hash retained JSON semantically and binary exports by verified bytes, without decoding archives as JSON. */
export function assetContentHash(release: any, name: string): string {
  if (!name.endsWith('.bin')) return hash(readAsset(release, name));
  const directory = mkdtempSync(resolve(tmpdir(), 'little-say-retained-check-'));
  try { return downloadAsset(release, name, resolve(directory, name)).slice('sha256:'.length); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

/** Verify preserved asset identities and contents before treating an abandoned journal as nonblocking. */
export function verifyRetirement(release: any, complete = true): Retirement {
  const record = readAsset<Retirement>(release, 'retirement.json');
  assert(record?.schema === 1 && record.releaseId === release.id && release.draft && release.tag_name === `abandoned/${record.runId}`, 'Abandoned journal identity is uncertain; reconcile before another cut.');
  assert(Array.isArray(record.assets) && record.assets.every(a => /^sha256:[a-f0-9]{64}$/.test(a.digest) && release.assets.some((r: any) => r.id === a.id && r.name === a.name && r.digest === a.digest) && assetContentHash(release, a.name) === a.hash), 'Retired journal assets changed or are missing.');
  assert(release.assets.every((a: any) => ['retirement.json', 'retirement-complete.json'].includes(a.name) || record.assets.some(r => r.id === a.id && r.name === a.name)), 'Unexpected retired journal assets; reconcile publication state.');
  if (record.kind === 'reconciled-partial') assert(record.evidenceHash === hash(readAsset(release, 'reconciliation.json')), 'Partial-release reconciliation evidence changed or is missing.');
  if (complete) assert(readAsset<{ retirementHash: string }>(release, 'retirement-complete.json')?.retirementHash === hash(record), 'Retirement readback is incomplete; reconcile before another cut.');
  return record;
}

/** Select completed manifests only; candidate drafts and plain server tags cannot advance client baselines. */
export function completedReceipts(): ReleaseReceipt[] {
  return releases().filter(r => !r.draft && /^release\/(internal|production)\/\d+$/.test(r.tag_name)).map(r => {
    const receipt = readAsset<ReleaseReceipt>(r, 'receipt.json');
    assert(receipt?.schema === 1 && r.tag_name === `release/${receipt.profile}/${receipt.runId}`, 'Completed release is missing its receipt.');
    return receipt;
  });
}

/** Own one candidate's immutable plan and append-only per-operation assets; each operation has a single job writer. */
export class Journal {
  readonly tag: string;
  /** Bind journal identity to a GitHub run ID, which remains unchanged across workflow retries. */
  constructor(readonly runId: string) {
    assert(/^[1-9]\d*$/.test(runId), 'Missing GitHub run ID.'); this.tag = `candidate/${runId}`;
  }
  /** Fetch current asset metadata so concurrent jobs writing different keys never overwrite a shared manifest. */
  release(): any | undefined {
    const all = releases(); this.assertActive(all); return all.find(r => r.tag_name === this.tag);
  }
  /** Reject durable retirement intent and abandoned run IDs before planning, writes, or provider work. */
  assertActive(all = releases()): void {
    assert(!all.some(r => r.tag_name === `abandoned/${this.runId}` || r.tag_name === this.tag && r.assets.some((a: any) => a.name === 'retirement.json')), `Release ${this.runId} is abandoned or retiring. Never rerun it; use a fresh cut.`);
  }
  /** Create the draft before external writes; reject another unresolved release across either client profile. */
  create(source: string): void {
    const all = releases();
    this.assertActive(all);
    for (const r of all.filter(r => /^abandoned\/\d+$/.test(r.tag_name))) verifyRetirement(r);
    assert(!all.some(r => r.draft && /^candidate\/\d+$/.test(r.tag_name) && r.tag_name !== this.tag), 'Another release is unresolved. Resume that workflow before starting another cut.');
    if (!all.some(r => r.tag_name === this.tag)) gh(['release', 'create', this.tag, '--repo', process.env.GITHUB_REPOSITORY!, '--draft', '--target', source, '--title', `Release candidate ${this.runId}`, '--notes', 'Recoverable release journal. This draft is not a completed release or a publication baseline.']);
  }
  /** Read a named immutable candidate document, returning undefined only when it has not been written. */
  read<T>(name: string): T | undefined { const r = this.release(); return r ? readAsset<T>(r, name) : undefined; }
  /** Upload once and verify content; never delete or clobber an existing journal asset during a retry. */
  put(name: string, value: unknown): void {
    assert(/^[a-z0-9.-]+\.json$/.test(name), 'Invalid journal asset name.');
    const old = this.read(name);
    if (old !== undefined) { assert(hash(old) === hash(value), `Journal asset ${name} conflicts with this run.`); return; }
    const path = resolve(mkdtempSync(resolve(tmpdir(), 'little-say-journal-')), name);
    writeJson(path, value);
    gh(['release', 'upload', this.tag, path, '--repo', process.env.GITHUB_REPOSITORY!]);
    assert(hash(this.read(name)) === hash(value), 'Journal readback failed. Do not repeat remote work until reconciled.');
  }
  /** Retain an export archive once; after an uncertain upload, recover the original asset instead of regenerating it. */
  putArchive(name: string, file: string): void {
    assert(/^[a-z0-9.-]+\.bin$/.test(name), 'Invalid binary journal asset name.');
    const digest = `sha256:${sha256(file)}`;
    const existing = this.release()?.assets.find((a: any) => a.name === name);
    if (!existing) gh(['release', 'upload', this.tag, file, '--repo', process.env.GITHUB_REPOSITORY!]);
    const release = this.release();
    assert(release?.assets.find((a: any) => a.name === name)?.digest === digest, 'Immutable export archive differs from the original upload.');
    downloadAsset(release, name, resolve(mkdtempSync(resolve(tmpdir(), 'little-say-export-check-')), name));
  }
  /** Get the latest sequence for one operation; historical intent and provider IDs remain available indefinitely. */
  operation<T>(key: string): Operation<T> | undefined {
    assert(/^[a-z0-9.-]+$/.test(key), 'Invalid operation key.');
    const r = this.release(); if (!r) return undefined;
    const names = r.assets.map((a: any) => a.name as string).filter((n: string) => n.startsWith(`op.${key}.`) && /\.\d{6}\.json$/.test(n)).sort();
    return names.length ? readAsset<Operation<T>>(r, names.at(-1)!) : undefined;
  }
  /** Append an operation transition atomically as a new asset; failures never erase the preceding receipt. */
  save<T>(state: Omit<Operation<T>, 'sequence' | 'schema'>): Operation<T> {
    const next = { ...state, schema: 1 as const, sequence: (this.operation(state.key)?.sequence || 0) + 1 };
    this.put(`op.${state.key}.${String(next.sequence).padStart(6, '0')}.json`, next); return next;
  }
}
