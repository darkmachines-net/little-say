/** @file Verifies durable draft receipts, profile-wide exclusion, immutable asset recovery, and independent operation writers. */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { run } from './common';
import { completedReceipts, Journal } from './journal';

vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), run: vi.fn() }));
let remote: any[], assets: Map<number, any>, lost: boolean, paths: string[];
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('GITHUB_REPOSITORY', 'test/app'); remote = []; assets = new Map(); lost = false; paths = [];
  vi.mocked(run).mockImplementation((command, args) => {
    expect(command).toBe('gh');
    if (args.includes('--slurp')) return JSON.stringify([remote]);
    if (args[0] === 'api') return JSON.stringify(assets.get(Number(args[1].split('/').at(-1))));
    if (args[1] === 'create') { remote.push({ tag_name: args[2], draft: true, assets: [] }); return ''; }
    if (args[1] === 'upload') {
      paths.push(dirname(args[3])); const doc = JSON.parse(readFileSync(args[3], 'utf8')); const id = assets.size + 1;
      assets.set(id, doc); remote.find(r => r.tag_name === args[2]).assets.push({ id, name: args[3].split(/[\\/]/).at(-1) });
      if (lost) throw Error('response lost after upload'); return '';
    }
    throw Error(`Unexpected GH operation ${args}`);
  });
});
afterEach(() => { vi.unstubAllEnvs(); for (const path of paths) rmSync(path, { recursive: true, force: true }); });
describe('durable append-only candidate journal', () => {
  it('blocks another unresolved run across profiles and allows its own retry', () => {
    const j = new Journal('123'); j.create('a'.repeat(40)); j.create('a'.repeat(40));
    expect(remote).toHaveLength(1); expect(() => new Journal('124').create('b'.repeat(40))).toThrow('unresolved');
  });
  it('recovers an upload timeout by reading the accepted immutable asset', () => {
    const j = new Journal('123'); j.create('a'.repeat(40)); lost = true;
    expect(() => j.put('plan.json', { runId: '123' })).toThrow('response lost');
    j.put('plan.json', { runId: '123' }); expect(assets.size).toBe(1);
    expect(() => j.put('plan.json', { runId: 'changed' })).toThrow('conflicts');
  });
  it('preserves per-platform operation history without overwriting parallel writers', () => {
    const j = new Journal('123'); j.create('a'.repeat(40));
    j.save({ key: 'build-android', status: 'intent', ids: [] }); j.save({ key: 'build-ios', status: 'intent', ids: [] });
    j.save({ key: 'build-android', status: 'running', ids: ['a'] }); j.save({ key: 'build-ios', status: 'complete', ids: ['i'], result: 'verified' });
    expect(j.operation('build-android')).toMatchObject({ sequence: 2, ids: ['a'] }); expect(j.operation('build-ios')).toMatchObject({ sequence: 2, result: 'verified' }); expect(assets.size).toBe(4);
  });
  it('only completed release receipts advance baselines', () => {
    remote.push({ tag_name: 'v1.0.0', draft: false, assets: [] }, { tag_name: 'release/internal/123', draft: true, assets: [] });
    expect(completedReceipts()).toEqual([]); remote[1].draft = false;
    expect(() => completedReceipts()).toThrow('missing its receipt');
  });
});
