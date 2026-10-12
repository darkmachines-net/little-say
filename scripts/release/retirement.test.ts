/** @file Exercises retirement with synthetic GitHub state, response loss, interrupted runs, and fail-closed publication boundaries. */

import { readFileSync, rmSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { git, run } from './common';
import { Journal, verifyRetirement } from './journal';
import { reconcileCandidates, retireCandidate } from './retirement';
import { hash } from './inputs';

vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), run: vi.fn(), git: vi.fn() }));
vi.mock('./metadata', async original => ({ ...await original<typeof import('./metadata')>(), validateCandidate: vi.fn() }));
const source = 'a'.repeat(40), candidate = 'b'.repeat(40), merged = 'c'.repeat(40), tree = 'd'.repeat(40);
let remote: any[], data: Map<number, any>, workflow: any, jobs: any[], pr: any, base: string, mergedTree: string;
let paths: Set<string>, loseRename: boolean, failRename: boolean, failReadback: boolean;
function asset(name: string, value: unknown): void {
  const id = data.size + 1; data.set(id, value); remote[0].assets.push({ id, name, digest: `sha256:${hash(value)}` });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('GITHUB_REPOSITORY', 'test/app'); vi.stubEnv('DEFAULT_BRANCH', 'master'); vi.stubEnv('GITHUB_RUN_ID', '124');
  remote = [{ id: 10, tag_name: 'candidate/123', target_commitish: source, author: { login: 'github-actions[bot]' }, draft: true, assets: [] }]; data = new Map(); paths = new Set();
  loseRename = false; failRename = false; failReadback = false; base = merged; mergedTree = source;
  workflow = { id: 123, head_sha: source, head_branch: 'master', path: '.github/workflows/cut-release.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'failure' };
  jobs = [{ name: 'prepare', conclusion: 'failure' }, { name: 'server', conclusion: 'skipped' }];
  pr = { number: 7, head: { ref: 'release/unified-run-123', sha: candidate, repo: { full_name: 'test/app' } }, base: { ref: 'master', repo: { full_name: 'test/app' } }, user: { login: 'github-actions[bot]' }, state: 'closed', merged: true, merge_commit_sha: merged, auto_merge: null };
  asset('plan.json', { schema: 1, source, runId: '123' }); asset('candidate.json', { candidate, tree });
  vi.mocked(git).mockImplementation(args => args[0] === 'ls-remote' ? args.at(-1)!.endsWith('/master') ? `${base}\trefs/heads/master` : '' : args[0] === 'rev-parse' ? args[1].startsWith(merged) ? mergedTree : tree : '');
  vi.mocked(run).mockImplementation((command, args) => {
    expect(command).toBe('gh');
    if (args.includes('--slurp')) return JSON.stringify(args.at(-1)!.includes('/jobs?') ? [{ total_count: jobs.length, jobs }] : [remote]);
    if (args[0] === 'pr') return JSON.stringify(pr ? [{ number: pr.number }] : []);
    if (args[0] === 'release' && args[1] === 'upload') {
      paths.add(dirname(args[3])); asset(basename(args[3]), JSON.parse(readFileSync(args[3], 'utf8'))); return '';
    }
    if (args[0] === 'release' && args[1] === 'create') { remote.push({ id: 11, tag_name: args[2], draft: true, assets: [] }); return ''; }
    const endpoint = args[1];
    if (endpoint.includes('/releases/assets/')) return JSON.stringify(data.get(Number(endpoint.split('/').at(-1))));
    if (endpoint.endsWith('/actions/runs/123')) return JSON.stringify(workflow);
    if (endpoint.endsWith('/pulls/7')) { if (args.includes('PATCH')) pr.state = 'closed'; return JSON.stringify(pr); }
    if (endpoint.endsWith('/releases/10')) {
      if (args.includes('PATCH')) { if (failRename) throw Error('rename refused'); remote[0].tag_name = 'abandoned/123'; if (loseRename) { loseRename = false; throw Error('rename response lost'); } }
      if (failReadback && remote[0].tag_name.startsWith('abandoned/')) throw Error('readback unavailable');
      return JSON.stringify(remote[0]);
    }
    throw Error(`Unexpected request ${args}`);
  });
});
afterEach(() => { vi.unstubAllEnvs(); for (const path of paths) rmSync(path, { recursive: true, force: true }); });
describe('unpublished candidate retirement', () => {
  it('retains the same release and original assets, records why, and unblocks only a fresh ID', () => {
    const originals = structuredClone(remote[0].assets);
    expect(retireCandidate('123')).toBe(true); verifyRetirement(remote[0]);
    expect(remote[0].id).toBe(10); expect(remote[0].assets.slice(0, 2)).toEqual(originals);
    expect(() => new Journal('123').assertActive()).toThrow('abandoned');
    expect(() => new Journal('123').create(source)).toThrow('abandoned');
    expect(() => new Journal('123').read('plan.json')).toThrow('abandoned');
    new Journal('124').create(merged); expect(remote).toHaveLength(2);
    expect(vi.mocked(run).mock.calls.some(([, a]) => a.includes('delete'))).toBe(false);
  });
  it('recovers a lost rename response idempotently without recreating the candidate', () => {
    loseRename = true; expect(() => retireCandidate('123')).toThrow('response lost');
    expect(() => new Journal('124').create(source)).toThrow('incomplete');
    reconcileCandidates('124'); const size = data.size; reconcileCandidates('124'); expect(data.size).toBe(size);
    verifyRetirement(remote[0]); expect(() => new Journal('123').create(source)).toThrow('abandoned');
  });
  it('keeps retirement intent blocking when cleanup fails before or after rename', () => {
    failRename = true; expect(() => retireCandidate('123')).toThrow('rename refused');
    expect(() => new Journal('123').assertActive()).toThrow('retiring');
    expect(() => new Journal('124').create(source)).toThrow('unresolved');
    failRename = false; failReadback = true; expect(() => retireCandidate('123')).toThrow('readback unavailable');
    expect(() => new Journal('124').create(source)).toThrow('incomplete');
    failReadback = false; reconcileCandidates('124'); verifyRetirement(remote[0]);
  });
  it.each(['intent', 'running', 'failed', 'complete'])('never retires a %s provider operation even without a successful receipt', status => {
    asset('op.build-android.000001.json', { status, ids: [] });
    expect(() => retireCandidate('123')).toThrow('Publication or unknown'); expect(remote[0].tag_name).toBe('candidate/123');
  });
  it.each(['prepared.json', 'receipt.json', 'ota.json', 'unknown.json'])('preserves publication/unknown state %s', name => {
    asset(name, {}); expect(() => retireCandidate('123')).toThrow('Publication or unknown');
  });
  it.each(['native (android)', 'promote-server', 'deploy / deploy'])('requires all-attempt job proof for %s, even without a saved operation asset', name => {
    jobs.push({ name, conclusion: 'cancelled' });
    expect(() => retireCandidate('123')).toThrow('non-prepare job');
    expect(data.size).toBe(2);
  });
  it('preserves active runs and mismatched workflow ownership', () => {
    workflow.status = 'in_progress'; expect(() => reconcileCandidates('124')).toThrow('active');
    workflow.status = 'completed'; workflow.head_sha = candidate; expect(() => retireCandidate('123')).toThrow('ownership');
  });
  it('cleans an interrupted stale run on the next cut without relying on its failure handler', () => {
    workflow.conclusion = 'cancelled'; reconcileCandidates('124'); verifyRetirement(remote[0]);
  });
  it('handles cancellation before a PR but preserves review waits and queued merges', () => {
    base = source; pr.merged = false; pr.state = 'open'; workflow.conclusion = 'cancelled';
    expect(retireCandidate('123')).toBe(false);
    pr.auto_merge = {}; expect(() => retireCandidate('123')).toThrow('queued merge');
    pr = undefined; expect(retireCandidate('123')).toBe(true);
  });
  it('closes only an exact owned stale open version PR and retains its branch', () => {
    pr.merged = false; pr.state = 'open'; expect(retireCandidate('123')).toBe(true); expect(pr.state).toBe('closed');
    expect(vi.mocked(git).mock.calls.some(([a]) => a[0] === 'push')).toBe(false);
  });
  it('refuses changed or foreign PRs and a changed retained asset', () => {
    pr.head.sha = source; expect(() => retireCandidate('123')).toThrow('identity');
    pr.head.sha = candidate; pr.user.login = 'someone-else'; expect(() => retireCandidate('123')).toThrow('ownership');
    pr.user.login = 'github-actions[bot]'; retireCandidate('123'); data.set(1, { altered: true });
    expect(() => new Journal('124').create(source)).toThrow('assets changed');
  });
  it('keeps an exact merged candidate retryable even when later master commits exist', () => {
    mergedTree = tree; base = 'e'.repeat(40);
    expect(retireCandidate('123')).toBe(false); expect(data.size).toBe(2);
  });
  it('supports synchronous stale failure cleanup only in its own in-progress prepare job', () => {
    workflow.status = 'in_progress'; vi.stubEnv('GITHUB_RUN_ID', '123'); expect(retireCandidate('123', true)).toBe(true);
  });
  it('recovers interruption between draft creation and the first plan upload', () => {
    remote[0].assets = []; data.clear(); pr = undefined; workflow.conclusion = 'cancelled';
    reconcileCandidates('124'); verifyRetirement(remote[0]);
    expect(() => new Journal('123').assertActive()).toThrow('abandoned');
  });
  it('keeps duplicate identities, missing byte digests, and foreign journals blocking', () => {
    remote.push({ ...remote[0], id: 11, tag_name: 'abandoned/123' }); expect(() => retireCandidate('123')).toThrow('Duplicate'); remote.pop();
    delete remote[0].assets[0].digest; expect(() => retireCandidate('123')).toThrow('byte digests');
    remote[0].author.login = 'another-user'; expect(() => retireCandidate('123')).toThrow('ownership');
  });
});
