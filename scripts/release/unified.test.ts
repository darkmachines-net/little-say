/** @file Verifies dry-run/no-op mutation boundaries, stale-source guards, and finalization recovery after lost GitHub responses. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync } from 'node:fs';
import { cleanCommit, git, readJson } from './common';
import { completedReceipts, gh, Journal, readAsset, releases } from './journal';
import { channelBranch, expoEnvironment, exportBundle, nativeFingerprint } from './expo';
import { prepareCandidate, validateReleaseSource } from './candidate';
import { legacyImage, promoteImage, publishImage, verifyImage } from './image';
import { cloudBuild, submitBuild } from './cloud';
import { publishOta } from './ota';
import { sourceInputs } from './inputs';
import { releaseConfig } from './native-contract';
import { unifiedRelease } from './unified';
import { planRelease } from './planner';
import type { NativeBuildBaseline, ReleasePlan, ReleaseReceipt } from './contract';
import { reconcileCandidates, retireCandidate } from './retirement';
import { StaleCandidateError } from './metadata';

vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), cleanCommit: vi.fn(), git: vi.fn(), readJson: vi.fn(), writeJson: vi.fn() }));
vi.mock('./journal', () => ({ Journal: vi.fn(), completedReceipts: vi.fn(), gh: vi.fn(), releases: vi.fn(), readAsset: vi.fn() }));
vi.mock('./retirement', () => ({ reconcileCandidates: vi.fn(), retireCandidate: vi.fn() }));
vi.mock('./expo', async original => ({ ...await original<typeof import('./expo')>(), channelBranch: vi.fn(), expoEnvironment: vi.fn(), nativeFingerprint: vi.fn(), preflightCredentials: vi.fn(), exportBundle: vi.fn(), otaEnvironment: vi.fn(() => ({})) }));
vi.mock('./candidate', () => ({ prepareCandidate: vi.fn(), validateReleaseSource: vi.fn() }));
vi.mock('./image', () => ({ legacyImage: vi.fn(), promoteImage: vi.fn(), publishImage: vi.fn(), verifyImage: vi.fn() }));
vi.mock('./cloud', () => ({ cloudBuild: vi.fn(), submitBuild: vi.fn() }));
vi.mock('./ota', () => ({ publishOta: vi.fn() }));
vi.mock('./version', async original => ({ ...await original<typeof import('./version')>(), checkVersions: vi.fn() }));
vi.mock('./native-contract', async original => ({ ...await original<typeof import('./native-contract')>(), releaseConfig: vi.fn() }));
vi.mock('./inputs', async original => ({ ...await original<typeof import('./inputs')>(), sourceInputs: vi.fn() }));
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), appendFileSync: vi.fn(), writeFileSync: vi.fn(), mkdtempSync: vi.fn(() => '/tmp/finalize') }));
const commit = 'a'.repeat(40), tree = 'b'.repeat(40);
const release = { version: '0.1.0', androidVersionCode: 1, iosBuildNumber: '1', expoOwner: 'test', expoProjectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', serverUrl: 'https://test.invalid' };
const inputs = { server: 'server-input', native: { android: 'native-android', ios: 'native-ios' }, bundle: { android: 'bundle-android', ios: 'bundle-ios' }, environmentHash: 'env-hash' };
let records: Map<string, any>, journal: any, remote: any[], history: ReleaseReceipt[], tags: Set<string>, loseUpload: boolean;
beforeEach(() => {
  vi.resetAllMocks(); records = new Map(); remote = []; history = []; tags = new Set(); loseUpload = false;
  for (const [key, value] of Object.entries({ GITHUB_ACTIONS: 'true', DEFAULT_BRANCH: 'master', GITHUB_REF: 'refs/heads/master', GITHUB_REPOSITORY: 'test/app', GITHUB_RUN_ID: '123', GITHUB_OUTPUT: '/tmp/outputs', RELEASE_MODE: 'auto', RELEASE_PROFILE: 'internal', RELEASE_BUMP: 'patch', RELEASE_DRY_RUN: 'false' })) vi.stubEnv(key, value);
  journal = { tag: 'candidate/123', release: vi.fn(() => records.size ? { tag_name: 'candidate/123' } : undefined), create: vi.fn(), read: vi.fn((name: string) => records.get(name)), put: vi.fn((name: string, value: any) => { if (records.has(name)) expect(records.get(name)).toEqual(value); else records.set(name, value); }), operation: vi.fn((key: string) => records.get(`op-${key}`)) };
  vi.mocked(Journal).mockImplementation(function () { return journal; });
  journal.assertActive = vi.fn();
  vi.mocked(cleanCommit).mockReturnValue(commit); vi.mocked(releaseConfig).mockReturnValue(release);
  vi.mocked(readJson).mockImplementation((path: string) => path.endsWith('release-policy.json') ? { schema: 1, importedBaselines: [], retiredRuntimes: [] } : { version: '0.2.0' });
  vi.mocked(sourceInputs).mockImplementation((_ref, target) => target === 'server' ? inputs.server : inputs.bundle[target]);
  vi.mocked(nativeFingerprint).mockImplementation(platform => inputs.native[platform]);
  vi.mocked(expoEnvironment).mockResolvedValue({ env: { LITTLE_SAY_CHANNEL: 'internal', EXPO_NO_DOTENV: '1', CI: '1' }, hash: inputs.environmentHash });
  vi.mocked(channelBranch).mockResolvedValue({ id: 'branch-id', name: 'internal' });
  vi.mocked(completedReceipts).mockImplementation(() => history);
  vi.mocked(verifyImage).mockReturnValue('sha256:digest'); vi.mocked(legacyImage).mockReturnValue(undefined);
  vi.mocked(git).mockImplementation(args => {
    if (args[0] === 'rev-parse') return args[1] === 'HEAD^{tree}' ? tree : commit;
    if (args[0] === 'ls-remote') return tags.has(args.at(-1)!) ? `${commit}\t${args.at(-1)}` : '';
    if (args[0] === 'push') tags.add(args.at(-1)!); return '';
  });
  vi.mocked(releases).mockImplementation(() => remote);
  vi.mocked(readAsset).mockImplementation((r: any) => r?.receipt);
  vi.mocked(gh).mockImplementation(args => {
    if (args[1] === 'create') remote.push({ tag_name: args[2], draft: true });
    if (args[1] === 'upload') { remote[0].receipt = records.get('receipt.json'); if (loseUpload) { loseUpload = false; throw Error('lost completion upload response'); } }
    if (args[1] === 'edit') { remote[0].draft = false; history.push(remote[0].receipt); }
    return '';
  });
});
afterEach(() => vi.unstubAllEnvs());
function previous(): ReleaseReceipt {
  const plan = planRelease({ runId: '122', source: commit, mode: 'auto', profile: 'internal', bump: 'patch', inputs, nativeRelease: release, serverVersion: '0.2.0' });
  const baselines = (['android', 'ios'] as const).map(platform => ({ schema: 2, platform, profile: 'internal', channel: 'internal', environment: 'preview', release, runtimeVersion: release.version, commit, fingerprint: 'f'.repeat(40), compatibility: inputs.native[platform], environmentHash: inputs.environmentHash, buildId: platform, artifactUrl: 'https://example.invalid/app', artifactSha256: 'a'.repeat(64) }) as NativeBuildBaseline);
  return { schema: 1, runId: '122', profile: 'internal', commit, completedAt: '2026-10-01', plan, prepared: { commit, candidate: commit, tree }, baselines, ota: [], server: { commit, version: '0.2.0', image: 'ghcr.io/test/app', digest: 'sha256:digest', input: inputs.server } };
}
describe('orchestration publication boundaries', () => {
  it('checks tombstones before planning and reconciles prior runs before allocating new work', async () => {
    journal.assertActive.mockImplementationOnce(() => { throw Error('abandoned'); });
    await expect(unifiedRelease('prepare')).rejects.toThrow('abandoned');
    expect(expoEnvironment).not.toHaveBeenCalled(); expect(reconcileCandidates).not.toHaveBeenCalled();
    vi.mocked(reconcileCandidates).mockImplementationOnce(() => { throw Error('prior unresolved'); });
    await expect(unifiedRelease('prepare')).rejects.toThrow('prior unresolved');
    expect(expoEnvironment).not.toHaveBeenCalled(); expect(journal.create).not.toHaveBeenCalled();
  });
  it('retires only terminal stale preparation and preserves the original error if cleanup fails', async () => {
    records.set('plan.json', { ...previous().plan, runId: '123' });
    vi.mocked(prepareCandidate).mockImplementation(() => { throw new StaleCandidateError('Default branch moved.'); });
    vi.mocked(retireCandidate).mockImplementationOnce(() => { throw Error('readback unavailable'); });
    await expect(unifiedRelease('prepare')).rejects.toThrow('immutable release source is stale');
    expect(retireCandidate).toHaveBeenCalledWith('123', true);
    vi.mocked(retireCandidate).mockClear();
    vi.mocked(prepareCandidate).mockImplementationOnce(() => { throw Error('Required review'); });
    await expect(unifiedRelease('prepare')).rejects.toThrow('Required review');
    expect(retireCandidate).not.toHaveBeenCalled(); expect(publishImage).not.toHaveBeenCalled();
  });
  it('validates forced dry-run operations without versions, PRs, or provider mutations', async () => {
    vi.stubEnv('RELEASE_MODE', 'force_all'); vi.stubEnv('RELEASE_DRY_RUN', 'true'); await unifiedRelease('prepare');
    expect(validateReleaseSource).toHaveBeenCalledOnce(); expect(exportBundle).toHaveBeenCalledTimes(2);
    expect(journal.create).not.toHaveBeenCalled(); expect(journal.put).not.toHaveBeenCalled(); expect(prepareCandidate).not.toHaveBeenCalled();
    for (const mutation of [publishImage, cloudBuild, submitBuild, publishOta, gh]) expect(mutation).not.toHaveBeenCalled();
    await expect(unifiedRelease('native')).rejects.toThrow('Dry run');
  });
  it('exits an automatic no-change cut without allocating persisted versions or tags', async () => {
    history.push(previous()); await unifiedRelease('prepare'); expect(journal.create).not.toHaveBeenCalled(); expect(prepareCandidate).not.toHaveBeenCalled();
    expect(appendFileSync).toHaveBeenCalledWith('/tmp/outputs', 'active=false\n');
  });
  it('rejects non-default branches and stale publication retries', async () => {
    vi.stubEnv('GITHUB_REF', 'refs/heads/feature'); await expect(unifiedRelease('prepare')).rejects.toThrow('default-branch'); vi.stubEnv('GITHUB_REF', 'refs/heads/master');
    records.set('plan.json', { ...previous().plan, runId: '123' }); records.set('prepared.json', previous().prepared); history.push({ ...previous(), commit: 'e'.repeat(40) });
    const gitImpl = vi.mocked(git).getMockImplementation()!;
    vi.mocked(git).mockImplementation(args => { if (args[0] === 'merge-base' && args[2] === 'e'.repeat(40)) throw Error('newer completion'); return gitImpl(args); });
    await expect(unifiedRelease('server')).rejects.toThrow('newer completion'); expect(publishImage).not.toHaveBeenCalled();
  });
  it('preserves a partially finalized release and completes its exact receipt after response loss', async () => {
    const old = previous(); const plan: ReleasePlan = { ...old.plan, runId: '123', server: false, native: [], submissions: [], ota: [], previousServer: old.server, baselines: old.baselines };
    records.set('plan.json', plan); records.set('prepared.json', old.prepared); loseUpload = true;
    await expect(unifiedRelease('finalize')).rejects.toThrow('lost completion'); expect(history).toEqual([]); expect(records.has('receipt.json')).toBe(true);
    const receipt = records.get('receipt.json'); await unifiedRelease('finalize'); expect(history).toEqual([receipt]);
    expect(vi.mocked(gh).mock.calls.filter(([args]) => args[1] === 'upload')).toHaveLength(1);
    expect(promoteImage).not.toHaveBeenCalled(); expect(cloudBuild).not.toHaveBeenCalled();
    await unifiedRelease('prepare'); expect(prepareCandidate).not.toHaveBeenCalled();
  });
});
