/** @file Ensures completion recovery requires terminal successful deployment/publication proof, rejects changed provider evidence, and never rebuilds or uploads OTA. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanCommit, git, readJson } from './common';
import { artifactHash } from './cloud';
import { publishCompletion } from './completion';
import { inspectCompletionCandidate, recoverCompletion } from './completion-recovery';
import { buildWithSubmissions, eas, expoEnvironment, updateGroups } from './expo';
import { verifyImage } from './image';
import { sourceInputs } from './inputs';
import { completedReceipts, gh, Journal, readAsset, releases } from './journal';
import { releaseConfig } from './native-contract';
import { verifyPublishedOta } from './ota';
import { readOperationHistory } from './reconciliation';

vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), cleanCommit: vi.fn(), git: vi.fn(), readJson: vi.fn(), writeJson: vi.fn() }));
vi.mock('./cloud', async original => ({ ...await original<typeof import('./cloud')>(), artifactHash: vi.fn() }));
vi.mock('./completion', () => ({ publishCompletion: vi.fn() }));
vi.mock('./expo', () => ({ buildWithSubmissions: vi.fn(), eas: vi.fn(), expoEnvironment: vi.fn(), updateGroups: vi.fn() }));
vi.mock('./image', () => ({ verifyImage: vi.fn() }));
vi.mock('./inputs', async original => ({ ...await original<typeof import('./inputs')>(), sourceInputs: vi.fn() }));
vi.mock('./journal', () => ({ completedReceipts: vi.fn(), gh: vi.fn(), Journal: vi.fn(), readAsset: vi.fn(), releases: vi.fn() }));
vi.mock('./native-contract', async original => ({ ...await original<typeof import('./native-contract')>(), releaseConfig: vi.fn() }));
vi.mock('./ota', () => ({ verifyPublishedOta: vi.fn() }));
vi.mock('./reconciliation', () => ({ readOperationHistory: vi.fn() }));
const commit = 'a'.repeat(40), source = 'b'.repeat(40), tree = 'c'.repeat(40), toolCommit = 'd'.repeat(40), fingerprint = 'e'.repeat(40), sha = 'f'.repeat(64);
let plan: any, prepared: any, candidate: any, records: Map<string, any>, jobs: any[], cuts: any[], builds: any[], operations: Map<string, any>, journal: any;
beforeEach(() => {
  vi.resetAllMocks();
  for (const [name, value] of Object.entries({ GITHUB_REPOSITORY: 'test/app', GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/master', DEFAULT_BRANCH: 'master', GITHUB_SHA: toolCommit, GITHUB_RUN_ID: '456', GITHUB_WORKFLOW_REF: 'test/app/.github/workflows/recover-release.yml@refs/heads/master' })) vi.stubEnv(name, value);
  const release = { version: '0.1.3', androidVersionCode: 4, iosBuildNumber: '4', expoOwner: 'test', expoProjectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', serverUrl: 'https://test.invalid' };
  plan = { schema: 1, runId: '123', source, profile: 'internal', mode: 'auto', server: true, serverVersion: '0.3.1', native: ['android', 'ios'], ota: ['android', 'ios'], submissions: [], baselines: [], previousOta: [], nativeRelease: release,
    inputs: { server: 'server-input', bundle: { android: 'android-input', ios: 'ios-input' }, native: { android: sha, ios: sha }, environmentHash: sha }, channelBranch: { id: 'branch', name: 'internal' } };
  prepared = { commit, candidate: commit, tree };
  records = new Map([['plan.json', plan], ['prepared.json', prepared], ['candidate.json', { candidate: commit, tree }], ['ota.json', { receipts: ['android', 'ios'].map(platform => ({ platform, runtimeVersion: '0.1.3', group: `group-${platform}` })), skipped: [] }]]);
  candidate = { id: 1, tag_name: 'candidate/123', draft: true, author: { login: 'github-actions[bot]' }, assets: [...records.keys()].map((name, id) => ({ id, name, digest: `sha256:${sha}` })) };
  jobs = ['prepare', 'server', 'promote-server', 'deploy / deploy', 'native (android)', 'native (ios)', 'ota', 'submit', 'finalize'].map((name, id) => ({ id, name, status: 'completed', conclusion: name === 'finalize' ? 'failure' : name === 'submit' ? 'skipped' : 'success' }));
  cuts = [{ status: 'completed' }];
  operations = new Map(); builds = [];
  operations.set('server', { status: 'complete', ids: [commit], result: { commit, image: 'ghcr.io/test/app', version: '0.3.1', input: 'server-input', digest: `sha256:${sha}` } });
  for (const [index, platform] of ['android', 'ios'].entries()) {
    const id = `00000000-0000-4000-8000-00000000000${index}`;
    const baseline = { schema: 2, commit, platform, profile: 'internal', channel: 'internal', environment: 'preview', release, runtimeVersion: '0.1.3', fingerprint, compatibility: sha, environmentHash: sha, buildId: id, artifactUrl: 'https://test.invalid/app', artifactSha256: sha };
    operations.set(`build-${platform}`, { status: 'complete', ids: [id], result: baseline });
    builds.push({ id, platform: platform.toUpperCase(), gitCommitHash: commit, buildProfile: 'internal', app: { id: release.expoProjectId }, appIdentifier: 'net.darkmachines.littlesay', appVersion: '0.1.3', appBuildVersion: '4', runtime: { version: '0.1.3' }, updateChannel: { name: 'internal' }, distribution: 'INTERNAL', isForIosSimulator: false, status: 'FINISHED', fingerprint: { hash: fingerprint }, artifacts: { applicationArchiveUrl: 'https://test.invalid/app' }, submissions: [], message: `little-say:123:build:${platform}` });
  }
  journal = { put: vi.fn() }; vi.mocked(Journal).mockImplementation(function () { return journal; });
  vi.mocked(cleanCommit).mockReturnValue(toolCommit); vi.mocked(completedReceipts).mockReturnValue([]);
  vi.mocked(readJson).mockReturnValue({ schema: 1, retiredRuntimes: [] });
  vi.mocked(git).mockImplementation(args => args[0] === 'rev-parse' ? tree : args[0] === 'show' ? JSON.stringify({ schema: 1, retiredRuntimes: [] }) : '');
  vi.mocked(sourceInputs).mockImplementation((_ref, target) => `${target}-input`);
  vi.mocked(releases).mockReturnValue([candidate]); vi.mocked(readAsset).mockImplementation((_release, name) => records.get(name));
  vi.mocked(gh).mockImplementation(args => {
    const path = args.find(a => a.startsWith('repos/'))!;
    if (path.includes('/workflows/')) return JSON.stringify([{ total_count: cuts.length, workflow_runs: cuts }]);
    if (path.includes('/jobs?')) return JSON.stringify([{ total_count: jobs.length, jobs }]);
    if (path.includes('/git/ref/')) return JSON.stringify({ object: { sha: commit } });
    return JSON.stringify({ id: 123, run_attempt: 3, head_sha: source, head_branch: 'master', event: 'workflow_dispatch', path: '.github/workflows/cut-release.yml', status: 'completed', conclusion: 'failure' });
  });
  vi.mocked(readOperationHistory).mockImplementation((_candidate, key) => operations.get(key) || { status: 'complete' });
  vi.mocked(releaseConfig).mockReturnValue(release); vi.mocked(expoEnvironment).mockResolvedValue({ env: { LITTLE_SAY_CHANNEL: 'internal', EXPO_NO_DOTENV: '1', CI: '1' }, hash: sha });
  vi.mocked(verifyImage).mockReturnValue(`sha256:${sha}`); vi.mocked(artifactHash).mockResolvedValue(sha);
  vi.mocked(buildWithSubmissions).mockImplementation(async id => builds.find(b => b.id === id));
  vi.mocked(eas).mockImplementation(args => JSON.stringify(builds.filter(b => b.platform.toLowerCase() === args[args.indexOf('--platform') + 1])));
  vi.mocked(updateGroups).mockImplementation(async (_branch, platform) => [[{ group: `group-${platform}`, message: `little-say:123:ota:${platform}-0.1.3:hash` }]]);
});
afterEach(() => vi.unstubAllEnvs());
it('previews verified original publications and applies only completion after a second audit', async () => {
  await recoverCompletion('123', false); expect(journal.put).not.toHaveBeenCalled(); expect(publishCompletion).not.toHaveBeenCalled();
  await recoverCompletion('123', true); expect(journal.put).toHaveBeenCalledWith('completion-recovery.json', expect.objectContaining({ runId: '123' })); expect(publishCompletion).toHaveBeenCalledOnce();
  expect(vi.mocked(eas).mock.calls.every(([args]) => args[0] === 'build:list')).toBe(true);
});
it('rejects active release cuts, missing deployment success and unknown journal assets', () => {
  cuts[0].status = 'in_progress'; expect(() => inspectCompletionCandidate('123')).toThrow('active'); cuts[0].status = 'completed';
  jobs.find(j => j.name === 'deploy / deploy').conclusion = 'failure'; expect(() => inspectCompletionCandidate('123')).toThrow('deploy'); jobs.find(j => j.name === 'deploy / deploy').conclusion = 'success';
  candidate.assets.push({ name: 'unknown.json' }); expect(() => inspectCompletionCandidate('123')).toThrow('Unknown');
});
it('rejects changed native artifact bytes and unrecorded matching builds before any completion write', async () => {
  vi.mocked(artifactHash).mockResolvedValueOnce('0'.repeat(64)); await expect(recoverCompletion('123', true)).rejects.toThrow('artifact bytes');
  builds.push({ ...builds[0], id: 'unrecorded' }); await expect(recoverCompletion('123', true)).rejects.toThrow('Unrecorded');
  expect(journal.put).not.toHaveBeenCalled(); expect(publishCompletion).not.toHaveBeenCalled();
});
it('rejects unexpected submissions, duplicate OTA operations and evidence changing during verification', async () => {
  builds[0].submissions.push({ id: 'submission' }); await expect(recoverCompletion('123', true)).rejects.toThrow('submission'); builds[0].submissions = [];
  vi.mocked(updateGroups).mockResolvedValueOnce([]); await expect(recoverCompletion('123', true)).rejects.toThrow('OTA provider');
  vi.mocked(verifyPublishedOta).mockImplementationOnce(async () => { candidate.assets[0].digest = `sha256:${'0'.repeat(64)}`; return { receipts: [], skipped: [] }; });
  await expect(recoverCompletion('123', true)).rejects.toThrow('changed during verification'); expect(publishCompletion).not.toHaveBeenCalled();
});
it('refuses local or mismatched workflow execution', async () => {
  vi.stubEnv('GITHUB_WORKFLOW_REF', 'test/app/.github/workflows/unrelated.yml@refs/heads/master');
  await expect(recoverCompletion('123', true)).rejects.toThrow('protected default-branch'); expect(eas).not.toHaveBeenCalled();
});
