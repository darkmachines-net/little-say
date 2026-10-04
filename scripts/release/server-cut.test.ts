/** @file Verifies release preparation retries reuse their own candidate and only publish validated merged commits. */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { cleanCommit, git, npm, run } from './common';
import { prepare, validateCommit } from './version';
import { cutServerRelease } from './server-cut';

vi.mock('./common', async importOriginal => ({
  ...await importOriginal<typeof import('./common')>(),
  cleanCommit: vi.fn(), git: vi.fn(), npm: vi.fn(), run: vi.fn(),
  readJson: vi.fn(() => ({ version: '0.1.2' })),
}));
vi.mock('./version', () => ({ prepare: vi.fn(), validateCommit: vi.fn(), serverFiles: ['release.json', 'package.json', 'apps/server/package.json', 'package-lock.json'] }));
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  appendFileSync: vi.fn(), writeFileSync: vi.fn(), mkdtempSync: vi.fn(prefix => `${prefix}fixture`),
}));

const base = 'a'.repeat(40);
const candidate = 'b'.repeat(40);
const merged = 'c'.repeat(40);
const branch = 'release/server-run-123';
const url = 'https://github.com/example/app/pull/7';
let checkedOut: string;
let remoteCandidate: string;
let existing: { url: string; state: string; baseRefName: string; headRefOid: string; mergeCommit: { oid: string } | null }[];
let otherOpen: { headRefName: string; url: string }[];
let mergeBlocked: boolean;
let afterMergeState: string;

function releasePr(state: string) {
  return { url, state, baseRefName: 'master', headRefOid: candidate, mergeCommit: state === 'MERGED' ? { oid: merged } : null };
}

beforeEach(() => {
  vi.resetAllMocks();
  checkedOut = base; remoteCandidate = ''; existing = []; otherOpen = []; mergeBlocked = false; afterMergeState = 'MERGED';
  for (const [key, value] of Object.entries({ GITHUB_ACTIONS: 'true', DEFAULT_BRANCH: 'master', GITHUB_REF: 'refs/heads/master', GITHUB_REPOSITORY: 'example/app', GITHUB_RUN_ID: '123', GITHUB_OUTPUT: 'output.txt', GITHUB_STEP_SUMMARY: 'summary.md', RELEASE_BUMP: 'patch' })) vi.stubEnv(key, value);
  vi.mocked(cleanCommit).mockImplementation(() => checkedOut);
  vi.mocked(validateCommit).mockReturnValue('0.1.2');
  vi.mocked(git).mockImplementation(args => {
    if (args[0] === 'ls-remote') return args[2] === 'refs/heads/master' ? `${base}\t${args[2]}` : remoteCandidate ? `${remoteCandidate}\t${args[2]}` : '';
    if (args[0] === 'rev-parse') return args[1] === 'FETCH_HEAD' ? remoteCandidate : checkedOut;
    if (args[0] === 'commit') checkedOut = candidate;
    if (args[0] === 'switch' && args[1] === '--detach') checkedOut = args[2];
    return '';
  });
  vi.mocked(run).mockImplementation((command, args) => {
    expect(command).toBe('gh');
    if (args[0] === 'api') return '';
    if (args[1] === 'list') return JSON.stringify(args.includes('--head') ? existing : otherOpen);
    if (args[1] === 'create') return url;
    if (args[1] === 'merge') { if (mergeBlocked) throw new Error('Required review prevents merge.'); return ''; }
    if (args[1] === 'view') return JSON.stringify(releasePr(afterMergeState));
    throw new Error(`Unexpected GitHub operation: ${args.join(' ')}`);
  });
});
afterEach(() => vi.unstubAllEnvs());

function output() { return vi.mocked(appendFileSync).mock.calls.filter(([file]) => file === 'output.txt').map(([, value]) => value).join(''); }
function operations(action: string) { return vi.mocked(run).mock.calls.filter(([, args]) => args[0] === 'pr' && args[1] === action); }

describe('one-run server releases', () => {
  it('checks and merges the candidate before passing its merged SHA to publication', () => {
    cutServerRelease();
    expect(prepare).toHaveBeenCalledWith('server', 'patch');
    expect(npm).toHaveBeenCalledWith(['run', 'check']);
    expect(git).toHaveBeenCalledWith(['push', 'origin', `HEAD:refs/heads/${branch}`]);
    expect(operations('create')).toHaveLength(1);
    expect(operations('merge')[0][1]).toContain('--match-head-commit');
    expect(operations('merge')[0][1]).toContain(candidate);
    expect(validateCommit).toHaveBeenCalledWith(candidate);
    expect(validateCommit).toHaveBeenCalledWith(merged);
    expect(git).toHaveBeenCalledWith(['merge-base', '--is-ancestor', merged, 'origin/master']);
    expect(output()).toBe(`commit=${merged}\n`);
    expect(vi.mocked(writeFileSync).mock.calls.some(([, value]) => String(value).includes('No commit SHA is required.'))).toBe(true);
  });

  it('resumes a merged PR without bumping, pushing, checking, or merging another candidate', () => {
    existing = [releasePr('MERGED')];
    cutServerRelease();
    expect(output()).toBe(`commit=${merged}\n`);
    expect(prepare).not.toHaveBeenCalled();
    expect(npm).not.toHaveBeenCalled();
    expect(operations('create')).toHaveLength(0);
    expect(operations('merge')).toHaveLength(0);
    expect(vi.mocked(git).mock.calls.some(([args]) => args[0] === 'push')).toBe(false);
  });

  it('rechecks and resumes an open PR after review without creating a duplicate', () => {
    existing = [releasePr('OPEN')]; remoteCandidate = candidate;
    otherOpen = [{ headRefName: branch, url }];
    cutServerRelease();
    expect(prepare).not.toHaveBeenCalled();
    expect(npm).toHaveBeenCalledWith(['run', 'check']);
    expect(operations('create')).toHaveLength(0);
    expect(operations('merge')).toHaveLength(1);
    expect(output()).toBe(`commit=${merged}\n`);
  });

  it('recovers a pushed branch when the previous attempt failed before PR creation', () => {
    remoteCandidate = candidate;
    cutServerRelease();
    expect(prepare).not.toHaveBeenCalled();
    expect(npm).toHaveBeenCalledWith(['run', 'check']);
    expect(operations('create')).toHaveLength(1);
    expect(output()).toBe(`commit=${merged}\n`);
  });

  it('leaves a review-blocked release unpublished and resumes the merged PR on retry', () => {
    mergeBlocked = true;
    expect(() => cutServerRelease()).toThrow('Required review');
    expect(output()).toBe('');
    existing = [releasePr('MERGED')];
    cutServerRelease();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(operations('create')).toHaveLength(1);
    expect(output()).toBe(`commit=${merged}\n`);
  });

  it('does not publish a queued PR before it has actually merged', () => {
    afterMergeState = 'OPEN';
    expect(() => cutServerRelease()).toThrow('Release PR is awaiting merge');
    expect(output()).toBe('');
  });

  it('rejects a closed, unmerged PR without replacing its release', () => {
    existing = [releasePr('CLOSED')];
    expect(() => cutServerRelease()).toThrow('closed without merging');
    expect(prepare).not.toHaveBeenCalled();
    expect(output()).toBe('');
  });

  it('does not adopt another run\'s open release', () => {
    otherOpen = [{ headRefName: 'release/server-run-456', url }];
    expect(() => cutServerRelease()).toThrow('Another server release PR');
    expect(prepare).not.toHaveBeenCalled();
    expect(operations('merge')).toHaveLength(0);
    expect(output()).toBe('');
  });

  it('rejects candidate validation failure before pushing or merging', () => {
    vi.mocked(validateCommit).mockImplementation(() => { throw new Error('Release includes source changes.'); });
    expect(() => cutServerRelease()).toThrow('source changes');
    expect(vi.mocked(git).mock.calls.some(([args]) => args[0] === 'push')).toBe(false);
    expect(operations('merge')).toHaveLength(0);
    expect(output()).toBe('');
  });

  it('rejects a changed candidate before merging', () => {
    existing = [releasePr('OPEN')]; remoteCandidate = 'd'.repeat(40);
    expect(() => cutServerRelease()).toThrow('source moved');
    expect(operations('merge')).toHaveLength(0);
    expect(output()).toBe('');
  });

  it('rejects a resumed merged commit that is not on the default branch', () => {
    existing = [releasePr('MERGED')];
    const normalGit = vi.mocked(git).getMockImplementation()!;
    vi.mocked(git).mockImplementation(args => {
      if (args[0] === 'merge-base') throw new Error('Commit is not merged to master.');
      return normalGit(args);
    });
    expect(() => cutServerRelease()).toThrow('not merged');
    expect(output()).toBe('');
  });
});
