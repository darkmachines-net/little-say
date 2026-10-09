/** @file Exercises protected candidate preparation, lost responses, PR review recovery, and moving-source rejection. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanCommit, git, npm } from './common';
import { gh, Journal } from './journal';
import { validateCandidate, writeReleaseDocuments } from './metadata';
import { prepareCandidate } from './candidate';
import type { ReleasePlan } from './contract';

vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), cleanCommit: vi.fn(), git: vi.fn(), npm: vi.fn(), writeJson: vi.fn() }));
vi.mock('./journal', () => ({ gh: vi.fn() }));
vi.mock('./metadata', async original => ({ ...await original<typeof import('./metadata')>(), validateCandidate: vi.fn(), writeReleaseDocuments: vi.fn(), releaseFiles: ['release.json'] }));
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), writeFileSync: vi.fn(), mkdtempSync: vi.fn(() => '/tmp/candidate') }));
const source = 'a'.repeat(40), candidate = 'b'.repeat(40), merged = 'c'.repeat(40), tree = 'd'.repeat(40);
const branch = 'release/unified-run-123';
const plan = { source, runId: '123', mode: 'force_all', profile: 'internal', server: true, native: ['android', 'ios'] } as ReleasePlan;
let head: string, remote: string, defaultHead: string, mergedTree: string, pr: any, blockMerge: boolean;
let records: Map<string, any>;
let journal: Journal;
const prFor = (state: string) => ({ url: 'https://github.com/test/app/pull/7', state, baseRefName: 'master', headRefOid: candidate, mergeCommit: state === 'MERGED' ? { oid: merged } : null });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('DEFAULT_BRANCH', 'master'); vi.stubEnv('GITHUB_REPOSITORY', 'test/app');
  head = source; remote = ''; defaultHead = source; mergedTree = tree; pr = undefined; blockMerge = false; records = new Map();
  journal = { read: vi.fn((name: string) => records.get(name)), put: vi.fn((name: string, value: any) => {
    if (name === 'candidate.json') expect(remote).toBe(candidate);
    if (records.has(name)) expect(records.get(name)).toEqual(value); else records.set(name, value);
  }) } as unknown as Journal;
  vi.mocked(cleanCommit).mockImplementation(() => head);
  vi.mocked(git).mockImplementation(args => {
    if (args[0] === 'ls-remote') return `${args[2].endsWith('/master') ? defaultHead : remote}${remote || args[2].endsWith('/master') ? `\t${args[2]}` : ''}`;
    if (args[0] === 'commit') head = candidate;
    if (args[0] === 'push') remote = candidate;
    if (args[0] === 'switch' && args[1] === '--detach') head = args[2] === 'FETCH_HEAD' ? remote : args[2];
    if (args[0] === 'rev-parse') return args[1].startsWith(merged) ? mergedTree : tree;
    return '';
  });
  vi.mocked(gh).mockImplementation(args => {
    if (args[0] === 'api') return '';
    if (args[1] === 'list') return JSON.stringify(pr ? [pr] : []);
    if (args[1] === 'create') { pr = prFor('OPEN'); return pr.url; }
    if (args[1] === 'view') return JSON.stringify(pr);
    if (args[1] === 'merge') { if (blockMerge) throw Error('Required review'); pr = prFor('MERGED'); return ''; }
    throw Error(`Unexpected operation ${args}`);
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('protected version candidate', () => {
  it('checks the combined candidate before push, normal merge, and exact tree readback', () => {
    expect(prepareCandidate(plan, journal)).toEqual({ commit: merged, candidate, tree });
    expect(writeReleaseDocuments).toHaveBeenCalledExactlyOnceWith(plan);
    expect(npm).toHaveBeenCalledWith(['run', 'test:integration']);
    expect(gh).toHaveBeenCalledWith(['pr', 'merge', pr.url, '--squash', '--match-head-commit', candidate]);
    expect(validateCandidate).toHaveBeenCalledWith(plan, merged);
  });
  it('recovers a pushed branch whose journal/PR response was lost without another increment', () => {
    remote = candidate;
    prepareCandidate(plan, journal); expect(writeReleaseDocuments).not.toHaveBeenCalled();
    expect(git).not.toHaveBeenCalledWith(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  });
  it('resumes after review and never bypasses it', () => {
    blockMerge = true; expect(() => prepareCandidate(plan, journal)).toThrow('Required review');
    expect(records.has('prepared.json')).toBe(false); pr = prFor('MERGED'); head = source;
    expect(prepareCandidate(plan, journal).commit).toBe(merged); expect(writeReleaseDocuments).toHaveBeenCalledTimes(1);
  });
  it('reuses a fully prepared candidate without repeating checks or PR mutations', () => {
    const prepared = prepareCandidate(plan, journal); vi.mocked(gh).mockClear(); vi.mocked(npm).mockClear();
    expect(prepareCandidate(plan, journal)).toEqual(prepared); expect(gh).not.toHaveBeenCalled(); expect(npm).not.toHaveBeenCalled();
  });
  it('does not record an unreachable commit after failed validation', () => {
    vi.mocked(npm).mockImplementation(() => { throw Error('checks failed'); });
    expect(() => prepareCandidate(plan, journal)).toThrow('checks failed'); expect(records.size).toBe(0); expect(remote).toBe('');
  });
  it('rejects moving functional source and abandoned or edited PRs', () => {
    defaultHead = merged; expect(() => prepareCandidate(plan, journal)).toThrow('Default branch moved');
    defaultHead = source; remote = candidate; pr = prFor('CLOSED'); expect(() => prepareCandidate(plan, journal)).toThrow('abandoned');
    pr = { ...prFor('OPEN'), headRefOid: source }; expect(() => prepareCandidate(plan, journal)).toThrow('head changed');
    pr = prFor('MERGED'); mergedTree = source; expect(() => prepareCandidate(plan, journal)).toThrow('Functional source moved');
  });
  it('rejects a queued merge until it actually lands', () => {
    const original = vi.mocked(gh).getMockImplementation()!;
    vi.mocked(gh).mockImplementation(args => args[1] === 'merge' ? '' : original(args));
    expect(() => prepareCandidate(plan, journal)).toThrow('awaits normal merge'); expect(records.has('prepared.json')).toBe(false);
  });
  it('rejects base movement during validation before requesting a merge', () => {
    vi.mocked(npm).mockImplementation(() => { defaultHead = merged; return ''; });
    expect(() => prepareCandidate(plan, journal)).toThrow('Default branch moved');
    expect(vi.mocked(gh).mock.calls.some(([args]) => args[1] === 'merge')).toBe(false);
    expect(records.has('prepared.json')).toBe(false);
  });
  it('keeps the exact-tree guard for movement after the last base check', () => {
    const original = vi.mocked(gh).getMockImplementation()!;
    vi.mocked(gh).mockImplementation(args => { if (args[1] === 'merge') mergedTree = source; return original(args); });
    expect(() => prepareCandidate(plan, journal)).toThrow('immutable release source is stale');
    expect(records.has('prepared.json')).toBe(false);
  });
});
