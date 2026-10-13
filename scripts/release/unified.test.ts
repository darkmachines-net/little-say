/** @file Verifies planning boundaries, protected promotion before deployment/OTA, and recoverable release completion. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync } from 'node:fs';
import { cleanCommit, git, readJson, writeJson } from './common';
import { completedReceipts, downloadAsset, gh, Journal, readAsset, releases } from './journal';
import { channelBranch, expoEnvironment, exportBundle, nativeFingerprint, nativeRuntime } from './expo';
import { prepareCandidate, validateReleaseSource } from './candidate';
import { legacyImage, promoteImage, publishImage, verifyImage } from './image';
import { cloudBuild, submitBuild } from './cloud';
import { publishOta, verifyPublishedOta } from './ota';
import { sourceInputs } from './inputs';
import { releaseConfig } from './native-contract';
import { unifiedRelease } from './unified';
import { planRelease } from './planner';
import type { NativeBuildBaseline, ReleasePlan, ReleaseReceipt } from './contract';
import { reconcileCandidates, retireCandidate } from './retirement';
import { StaleCandidateError } from './metadata';

vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), cleanCommit: vi.fn(), git: vi.fn(), readJson: vi.fn(), writeJson: vi.fn() }));
vi.mock('./journal', () => ({ Journal: vi.fn(), completedReceipts: vi.fn(), downloadAsset: vi.fn(), gh: vi.fn(), releases: vi.fn(), readAsset: vi.fn() }));
vi.mock('./retirement', () => ({ reconcileCandidates: vi.fn(), retireCandidate: vi.fn() }));
vi.mock('./expo', async original => ({ ...await original<typeof import('./expo')>(), channelBranch: vi.fn(), expoEnvironment: vi.fn(), nativeFingerprint: vi.fn(), nativeRuntime: vi.fn(), preflightCredentials: vi.fn(), exportBundle: vi.fn(), otaEnvironment: vi.fn(() => ({})) }));
vi.mock('./candidate', () => ({ prepareCandidate: vi.fn(), validateReleaseSource: vi.fn() }));
vi.mock('./image', () => ({ legacyImage: vi.fn(), promoteImage: vi.fn(), publishImage: vi.fn(), verifyImage: vi.fn() }));
vi.mock('./cloud', () => ({ cloudBuild: vi.fn(), submitBuild: vi.fn() }));
vi.mock('./ota', () => ({ publishOta: vi.fn(), verifyPublishedOta: vi.fn() }));
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
  for (const [key, value] of Object.entries({ GITHUB_ACTIONS: 'true', DEFAULT_BRANCH: 'master', GITHUB_REF: 'refs/heads/master', GITHUB_REPOSITORY: 'test/app', RELEASE_WORKFLOW_COMMIT: 'c'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_OUTPUT: '/tmp/outputs', RELEASE_PROFILE: 'internal', RELEASE_BUMP: 'patch' })) vi.stubEnv(key, value);
  journal = { tag: 'candidate/123', release: vi.fn(() => records.size ? { id: 1, draft: true, tag_name: 'candidate/123', assets: [...records.keys()].map((name, id) => ({ id, name, digest: 'sha256:fixture' })) } : undefined), create: vi.fn(), read: vi.fn((name: string) => records.get(name)), put: vi.fn((name: string, value: any) => { if (records.has(name)) expect(records.get(name)).toEqual(value); else records.set(name, value); }), operation: vi.fn((key: string) => records.get(`op-${key}`)) };
  vi.mocked(Journal).mockImplementation(function () { return journal; });
  journal.assertActive = vi.fn();
  vi.mocked(cleanCommit).mockReturnValue(commit); vi.mocked(releaseConfig).mockReturnValue(release);
  vi.mocked(readJson).mockImplementation((path: string) => path.endsWith('release-policy.json') ? { schema: 1, importedBaselines: [], retiredRuntimes: [] } : path.endsWith('release-engine.lock.json') ? { revision: 'd'.repeat(40) } : { version: '0.2.0' });
  vi.mocked(sourceInputs).mockImplementation((_ref, target) => target === 'server' ? inputs.server : inputs.bundle[target]);
  vi.mocked(nativeFingerprint).mockImplementation(platform => inputs.native[platform]);
  vi.mocked(nativeRuntime).mockReturnValue('f'.repeat(40));
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
  vi.mocked(readAsset).mockImplementation((r: any, name) => r?.tag_name === 'candidate/123' ? records.get(name) : r?.documents?.[name]);
  vi.mocked(downloadAsset).mockReturnValue('sha256:fixture');
  vi.mocked(verifyPublishedOta).mockImplementation(async (_plan, _commit, _baselines, _journal, saved) => saved);
  vi.mocked(gh).mockImplementation(args => {
    if (args[1] === 'create') remote.push({ tag_name: args[2], draft: true, documents: {}, assets: [] });
    if (args[1] === 'upload') {
      const name = args[3].split(/[\\/]/).at(-1)!;
      if (name.endsWith('.bin')) remote[0].assets.push({ name, digest: 'sha256:fixture' });
      else remote[0].documents[name] = [...vi.mocked(writeJson).mock.calls].reverse().find(([path]) => path === args[3])![1];
      if (loseUpload) { loseUpload = false; throw Error('lost completion upload response'); }
    }
    if (args[1] === 'edit') { remote[0].draft = false; history.push(remote[0].documents['receipt.json']); }
    return '';
  });
});
afterEach(() => vi.unstubAllEnvs());
function previous(): ReleaseReceipt {
  const plan = planRelease({ runId: '122', source: commit, profile: 'internal', bump: 'patch', inputs, nativeRelease: release, serverVersion: '0.2.0' });
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
  it('previews detected operations outside Actions without versions, PRs, or provider mutations', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'false'); vi.stubEnv('GITHUB_REF', 'refs/heads/feature'); await unifiedRelease('plan');
    expect(validateReleaseSource).toHaveBeenCalledOnce(); expect(exportBundle).toHaveBeenCalledTimes(2);
    expect(journal.create).not.toHaveBeenCalled(); expect(journal.put).not.toHaveBeenCalled(); expect(prepareCandidate).not.toHaveBeenCalled();
    for (const mutation of [publishImage, cloudBuild, submitBuild, publishOta, gh]) expect(mutation).not.toHaveBeenCalled();
    expect(reconcileCandidates).not.toHaveBeenCalled(); expect(retireCandidate).not.toHaveBeenCalled();
    await expect(unifiedRelease('native')).rejects.toThrow('default-branch');
  });
  it('exits an automatic no-change cut without allocating persisted versions or tags', async () => {
    vi.stubEnv('RELEASE_MODE', 'force_all');
    const completed = previous(); completed.baselines = completed.baselines.map(b => ({ ...b, schema: 3, runtimePolicy: 'fingerprint', runtimeVersion: 'f'.repeat(40) }));
    history.push(completed); await unifiedRelease('prepare'); expect(journal.create).not.toHaveBeenCalled(); expect(prepareCandidate).not.toHaveBeenCalled();
    expect(appendFileSync).toHaveBeenCalledWith('/tmp/outputs', 'active=false\n');
    expect(reconcileCandidates).toHaveBeenCalledOnce();
  });
  it('rejects the removed dry-run switch before any publication-side effects', async () => {
    vi.stubEnv('RELEASE_DRY_RUN', 'true');
    await expect(unifiedRelease('prepare')).rejects.toThrow('Use npm run release:plan');
    expect(reconcileCandidates).not.toHaveBeenCalled(); expect(journal.create).not.toHaveBeenCalled(); expect(expoEnvironment).not.toHaveBeenCalled();
    await unifiedRelease('plan');
    expect(journal.create).not.toHaveBeenCalled(); expect(prepareCandidate).not.toHaveBeenCalled();
  });
  it.each(['auto', 'force_all'] as const)('resumes a historical %s plan with its original patch allocation and provider records', async mode => {
    const old = previous();
    const saved: ReleasePlan = { ...old.plan, runId: '123', mode, bump: 'major', nativeRelease: { ...release, version: '0.1.1', androidVersionCode: 2, iosBuildNumber: '2' } };
    const recordedBuild = { status: 'complete', ids: ['original-build'], result: old.baselines[0] };
    records.set('plan.json', saved); records.set('prepared.json', old.prepared); records.set('op-build-android', recordedBuild);
    const before = structuredClone([...records.entries()]);
    vi.stubEnv('RELEASE_BUMP', 'major'); vi.mocked(prepareCandidate).mockReturnValue(old.prepared);
    await unifiedRelease('prepare');
    expect(prepareCandidate).toHaveBeenCalledWith(saved, journal);
    expect([...records.entries()]).toEqual(before);
    expect(expoEnvironment).not.toHaveBeenCalled(); expect(sourceInputs).not.toHaveBeenCalled(); expect(nativeFingerprint).not.toHaveBeenCalled();
    expect(cloudBuild).not.toHaveBeenCalled(); expect(publishImage).not.toHaveBeenCalled(); expect(publishOta).not.toHaveBeenCalled();
    expect(appendFileSync).toHaveBeenCalledWith('/tmp/outputs', 'active=true\n');
  });
  it.each([{ RELEASE_BUMP: 'minor' }, { RELEASE_PROFILE: 'production' }])('rejects changed inputs when resuming a saved plan: %j', async change => {
    records.set('plan.json', { ...previous().plan, runId: '123' });
    for (const [key, value] of Object.entries(change)) vi.stubEnv(key, value);
    await expect(unifiedRelease('prepare')).rejects.toThrow('Run inputs differ');
    expect(prepareCandidate).not.toHaveBeenCalled(); expect(journal.put).not.toHaveBeenCalled();
  });
  it.each(['server', 'promote-server'])('rejects non-default branches and stale %s retries', async command => {
    vi.stubEnv('GITHUB_REF', 'refs/heads/feature'); await expect(unifiedRelease('prepare')).rejects.toThrow('default-branch'); vi.stubEnv('GITHUB_REF', 'refs/heads/master');
    records.set('plan.json', { ...previous().plan, runId: '123' }); records.set('prepared.json', previous().prepared); history.push({ ...previous(), commit: 'e'.repeat(40) });
    const gitImpl = vi.mocked(git).getMockImplementation()!;
    vi.mocked(git).mockImplementation(args => { if (args[0] === 'merge-base' && args[2] === 'e'.repeat(40)) throw Error('newer completion'); return gitImpl(args); });
    await expect(unifiedRelease(command)).rejects.toThrow('newer completion'); expect(publishImage).not.toHaveBeenCalled(); expect(promoteImage).not.toHaveBeenCalled();
  });
  it.each(['missing', 'running', 'failed', 'wrong-commit', 'wrong-version', 'wrong-input', 'wrong-image', 'unplanned'])('requires the matching completed server publication before promotion: %s', async state => {
    const old = previous();
    const plan = { ...old.plan, runId: '123', server: state !== 'unplanned', serverVersion: old.server!.version };
    records.set('plan.json', plan); records.set('prepared.json', old.prepared);
    const receipt = { ...old.server! };
    if (state === 'wrong-commit') receipt.commit = 'c'.repeat(40);
    if (state === 'wrong-version') receipt.version = '9.0.0';
    if (state === 'wrong-input') receipt.input = 'other-source';
    if (state === 'wrong-image') receipt.image = 'ghcr.io/other/app';
    if (state !== 'missing') records.set('op-server', { status: state === 'running' || state === 'failed' ? state : 'complete', result: receipt });
    await expect(unifiedRelease('promote-server')).rejects.toThrow(/publication|not planned/);
    expect(promoteImage).not.toHaveBeenCalled(); expect(publishImage).not.toHaveBeenCalled();
  });
  it('retries promotion and OTA without rebuilding or advancing latest again during finalization', async () => {
    const old = previous();
    const plan: ReleasePlan = { ...old.plan, runId: '123', server: true, serverVersion: old.server!.version, native: [], submissions: [], ota: ['android'], baselines: old.baselines };
    records.set('plan.json', plan); records.set('prepared.json', old.prepared);
    records.set('op-server', { status: 'complete', result: old.server });
    vi.mocked(promoteImage).mockImplementationOnce(() => { throw Error('latest response lost'); });
    await expect(unifiedRelease('promote-server')).rejects.toThrow('latest response lost');
    await unifiedRelease('promote-server');
    expect(promoteImage).toHaveBeenCalledTimes(2); expect(promoteImage).toHaveBeenLastCalledWith(old.server);
    expect(records.has('receipt.json')).toBe(false);
    vi.mocked(publishOta).mockRejectedValueOnce(Error('OTA provider unavailable')).mockResolvedValue({ receipts: [], skipped: [] });
    await expect(unifiedRelease('ota')).rejects.toThrow('OTA provider unavailable');
    expect(records.has('receipt.json')).toBe(false); expect(history).toEqual([]);
    await unifiedRelease('ota'); await unifiedRelease('finalize');
    expect(verifyPublishedOta).toHaveBeenCalledOnce(); expect(publishOta).toHaveBeenCalledTimes(2);
    expect(promoteImage).toHaveBeenCalledTimes(2); expect(publishImage).not.toHaveBeenCalled();
    expect(history).toHaveLength(1); expect(history[0].server).toEqual(old.server);
  });
  it('preserves a partially finalized release and completes its exact receipt after response loss', async () => {
    const old = previous(); const plan: ReleasePlan = { ...old.plan, runId: '123', server: false, native: [], submissions: [], ota: [], previousServer: old.server, baselines: old.baselines };
    records.set('plan.json', plan); records.set('prepared.json', old.prepared); loseUpload = true;
    await expect(unifiedRelease('finalize')).rejects.toThrow('lost completion'); expect(history).toEqual([]); expect(records.has('receipt.json')).toBe(true);
    const receipt = records.get('receipt.json'); await unifiedRelease('finalize'); expect(history).toEqual([receipt]);
    expect(vi.mocked(gh).mock.calls.filter(([args]) => args[1] === 'upload')).toHaveLength(2);
    expect(remote[0].documents['journal.json'].assets.some((a: any) => a.name === 'receipt.json' && a.content === receipt)).toBe(true);
    expect(promoteImage).not.toHaveBeenCalled(); expect(cloudBuild).not.toHaveBeenCalled();
    await unifiedRelease('prepare'); expect(prepareCandidate).not.toHaveBeenCalled();
  });
  it('retains and verifies binary exports before deleting the candidate journal', async () => {
    const old = previous(); const plan: ReleasePlan = { ...old.plan, runId: '123', server: false, native: [], submissions: [], ota: [], previousServer: old.server, baselines: old.baselines };
    records.set('plan.json', plan); records.set('prepared.json', old.prepared); records.set('export.android.abc.bin', Buffer.from('original bytes'));
    vi.mocked(downloadAsset).mockImplementationOnce(() => { throw Error('archive download interrupted'); });
    await expect(unifiedRelease('finalize')).rejects.toThrow('archive download interrupted');
    expect(vi.mocked(gh).mock.calls.some(([args]) => args[1] === 'delete')).toBe(false);
    await unifiedRelease('finalize');
    expect(vi.mocked(downloadAsset).mock.calls.map(([release]) => release.tag_name)).toEqual(['candidate/123', 'candidate/123', 'release/internal/123']);
    expect(remote[0].documents['journal.json'].assets.find((asset: any) => asset.name.endsWith('.bin'))).toMatchObject({ retainedAsset: 'export.android.abc.bin' });
    expect(vi.mocked(gh).mock.calls.some(([args]) => args[1] === 'delete')).toBe(true);
  });
});
