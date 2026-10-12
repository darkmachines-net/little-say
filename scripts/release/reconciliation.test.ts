/** @file Verifies explicit partial-release recovery rejects uncertain work and preserves every asset across interrupted archival. */

import { readFileSync, rmSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { run } from './common';
import { buildWithSubmissions, eas } from './expo';
import { hash } from './inputs';
import { completedReceipts, Journal, verifyRetirement } from './journal';
import { abandonPartialRelease, inspectPartialRelease } from './reconciliation';

vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), run: vi.fn() }));
vi.mock('./expo', () => ({ buildWithSubmissions: vi.fn(), eas: vi.fn() }));
const source = 'a'.repeat(40), commit = 'b'.repeat(40), tree = 'c'.repeat(40);
const reason = 'Abandon remaining internal work so a fresh cut can include the iOS source fix.';
const native = { version: '0.1.2', androidVersionCode: 3, iosBuildNumber: '3', expoOwner: 'owner', expoProjectId: 'project', serverUrl: 'https://example.invalid' };
const android = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ios = '11111111-2222-3333-4444-555555555555';
let remote: any[], data: Map<number, any>, jobs: any[], workflow: any, builds: any[], paths: Set<string>, loseRename: boolean, loseUpload: string, active: boolean;
function asset(name: string, value: unknown): void {
  const id = data.size + 1; data.set(id, value); remote[0].assets.push({ id, name, digest: `sha256:${hash(value)}` });
}
function change(name: string, value: any): void { data.set(remote[0].assets.find((a: any) => a.name === name).id, value); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('GITHUB_REPOSITORY', 'test/app');
  remote = [{ id: 10, tag_name: 'candidate/123', draft: true, author: { login: 'github-actions[bot]' }, assets: [] }]; data = new Map(); paths = new Set(); loseRename = false; loseUpload = ''; active = false;
  workflow = { id: 123, run_attempt: 1, head_sha: source, head_branch: 'master', path: '.github/workflows/cut-release.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'failure' };
  jobs = ['prepare', 'server', 'native (android)', 'native (ios)', 'ota', 'submit', 'finalize'].map((name, id) => ({ id, name, run_attempt: 1, status: 'completed', conclusion: id < 3 ? 'success' : id === 3 ? 'failure' : 'skipped' }));
  builds = ['android', 'ios'].map((platform, i) => ({ id: i ? ios : android, platform: platform.toUpperCase(), status: i ? 'ERRORED' : 'FINISHED', message: `little-say:123:build:${platform}`, gitCommitHash: commit, buildProfile: 'internal', app: { id: 'project' }, appIdentifier: 'net.darkmachines.littlesay', appVersion: '0.1.2', appBuildVersion: '3', runtime: { version: '0.1.2' }, updateChannel: { name: 'internal' }, distribution: 'INTERNAL', isForIosSimulator: false, submissions: [], fingerprint: { hash: 'd'.repeat(40) } }));
  asset('plan.json', { schema: 1, runId: '123', source, profile: 'internal', server: true, serverVersion: '0.3.0', submissions: [], native: ['android', 'ios'], nativeRelease: native, inputs: { server: 'server-input', environmentHash: 'e'.repeat(64), native: { android: 'f'.repeat(64), ios: 'f'.repeat(64) } } });
  asset('candidate.json', { candidate: commit, tree }); asset('prepared.json', { commit, candidate: commit, tree });
  asset('op.server.000001.json', { schema: 1, sequence: 1, key: 'server', status: 'complete', ids: [commit], result: { image: 'ghcr.io/test/app', commit, version: '0.3.0', digest: `sha256:${'0'.repeat(64)}`, input: 'server-input' } });
  asset('op.build-android.000001.json', { schema: 1, sequence: 1, key: 'build-android', status: 'complete', ids: [android], result: { schema: 2, commit, platform: 'android', profile: 'internal', channel: 'internal', environment: 'preview', release: native, runtimeVersion: '0.1.2', fingerprint: 'd'.repeat(40), compatibility: 'f'.repeat(64), environmentHash: 'e'.repeat(64), buildId: android, artifactUrl: 'https://example.invalid/app.apk', artifactSha256: '1'.repeat(64) } });
  asset('op.build-ios.000001.json', { schema: 1, sequence: 1, key: 'build-ios', status: 'failed', ids: [ios] });
  vi.mocked(eas).mockImplementation(args => JSON.stringify(builds.filter(b => b.platform.toLowerCase() === args[args.indexOf('--platform') + 1])));
  vi.mocked(buildWithSubmissions).mockImplementation(async id => builds.find(b => b.id === id));
  vi.mocked(run).mockImplementation((command, args) => {
    expect(command).toBe('gh');
    if (args[0] === 'release' && args[1] === 'upload') {
      paths.add(dirname(args[3])); const name = basename(args[3]); asset(name, JSON.parse(readFileSync(args[3], 'utf8')));
      if (loseUpload === name) { loseUpload = ''; throw Error('upload response lost'); } return '';
    }
    const endpoint = args.at(-1)!;
    if (args.includes('--slurp')) {
      if (endpoint.includes('/jobs?')) return JSON.stringify([{ total_count: jobs.length, jobs }]);
      if (endpoint.includes('/workflows/')) return JSON.stringify([{ total_count: 1, workflow_runs: [{ ...workflow, status: active ? 'in_progress' : 'completed' }] }]);
      return JSON.stringify([remote]);
    }
    if (args[1].includes('/releases/assets/')) return JSON.stringify(data.get(Number(args[1].split('/').at(-1))));
    if (args[1].endsWith('/actions/runs/123')) return JSON.stringify(workflow);
    if (args[1].endsWith('/git/ref/tags/v0.3.0')) return JSON.stringify({ object: { type: 'commit', sha: commit } });
    if (args[1] === 'repos/test/app') return JSON.stringify({ default_branch: 'master' });
    if (args[1].endsWith('/releases/10')) {
      if (args.includes('PATCH')) { remote[0].tag_name = 'abandoned/123'; if (loseRename) { loseRename = false; throw Error('rename response lost'); } }
      return JSON.stringify(remote[0]);
    }
    throw Error(`Unexpected GitHub operation ${args}`);
  });
});
afterEach(() => { vi.unstubAllEnvs(); for (const path of paths) rmSync(path, { recursive: true, force: true }); });

it('previews without writes, retains successful artifacts, and never claims a completed baseline', async () => {
  const evidence = await inspectPartialRelease('123', reason);
  expect(data.size).toBe(6);
  const originals = structuredClone(remote[0].assets);
  await abandonPartialRelease(evidence);
  expect(remote[0].tag_name).toBe('abandoned/123'); expect(remote[0].assets.slice(0, 6)).toEqual(originals);
  expect(verifyRetirement(remote[0]).kind).toBe('reconciled-partial'); expect(completedReceipts()).toEqual([]);
  expect(() => new Journal('123').assertActive()).toThrow('abandoned');
  expect(vi.mocked(run).mock.calls.some(([, args]) => args.includes('delete') || args.includes('--clobber'))).toBe(false);
  const size = data.size; await abandonPartialRelease(evidence); expect(data.size).toBe(size);
});
it.each(['reconciliation.json', 'retirement.json', 'retirement-complete.json', 'rename'])('resumes after losing the %s response without replacing evidence', async step => {
  const evidence = await inspectPartialRelease('123', reason);
  if (step === 'rename') loseRename = true; else loseUpload = step;
  await expect(abandonPartialRelease(evidence)).rejects.toThrow('response lost');
  await abandonPartialRelease(evidence); verifyRetirement(remote[0]); expect(data.size).toBe(9);
});
it.each(['ota', 'submit', 'deploy / deploy', 'promote-server', 'unknown'])('rejects any executed %s job across attempts', async name => {
  jobs.push({ id: 99, name, status: 'completed', conclusion: 'cancelled', run_attempt: 2 });
  await expect(inspectPartialRelease('123', reason)).rejects.toThrow('jobs may have run'); expect(data.size).toBe(6);
});
it.each(['intent', 'running'])('rejects unresolved %s even when GitHub jobs are terminal', async status => {
  change('op.build-ios.000001.json', { schema: 1, sequence: 1, key: 'build-ios', status, ids: [ios] });
  await expect(inspectPartialRelease('123', reason)).rejects.toThrow('Unresolved');
});
it.each(['IN_PROGRESS', 'IN_QUEUE', 'FINISHED'])('rejects provider status %s that contradicts the failed iOS receipt', async status => {
  builds[1].status = status; await expect(inspectPartialRelease('123', reason)).rejects.toThrow('terminal outcome differs');
});
it('rejects unrecorded builds, submissions, and successful build fingerprint drift', async () => {
  builds.push({ ...builds[1], id: 'extra' }); await expect(inspectPartialRelease('123', reason)).rejects.toThrow('Unrecorded'); builds.pop();
  builds[0].submissions = [{ id: 'submission' }]; await expect(inspectPartialRelease('123', reason)).rejects.toThrow('submission state'); builds[0].submissions = [];
  builds[0].fingerprint.hash = '0'.repeat(40); await expect(inspectPartialRelease('123', reason)).rejects.toThrow('receipt differs');
});
it('rejects active cuts, unknown assets, and a changed journal between preview and apply', async () => {
  active = true; await expect(inspectPartialRelease('123', reason)).rejects.toThrow('active'); active = false;
  const evidence = await inspectPartialRelease('123', reason);
  asset('receipt.json', {}); await expect(abandonPartialRelease(evidence)).rejects.toThrow('unknown assets'); remote[0].assets.pop();
  change('candidate.json', { candidate: commit, tree, changed: true });
  await expect(abandonPartialRelease(evidence)).rejects.toThrow('evidence changed'); expect(remote[0].tag_name).toBe('candidate/123');
});
it('rejects contradictory successful operation history', async () => {
  asset('op.build-android.000002.json', { schema: 1, sequence: 2, key: 'build-android', status: 'failed', ids: [android] });
  await expect(inspectPartialRelease('123', reason)).rejects.toThrow('Rewritten');
});
