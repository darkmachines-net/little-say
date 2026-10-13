/** @file Tests EAS build/submission readback, exact-ID recovery, OTA payload integrity, retirement, and profile isolation. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanCommit, readJson } from './common';
import { cloudBuild, submitBuild, verifyBuildIdentity } from './cloud';
import { buildWithSubmissions, eas, expoEnvironment, nativeFingerprint } from './expo';
import type { NativeBuildBaseline, Operation, ReleasePlan } from './contract';
import { Journal } from './journal';
import { eligibleBaselines, verifyUpdate } from './ota';
import { planRelease } from './planner';

vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), cleanCommit: vi.fn(), readJson: vi.fn() }));
vi.mock('./expo', () => ({ buildWithSubmissions: vi.fn(), eas: vi.fn(), expoEnvironment: vi.fn(), nativeFingerprint: vi.fn() }));
const commit = 'a'.repeat(40), fingerprint = 'b'.repeat(40), compatibility = 'c'.repeat(64), environmentHash = 'd'.repeat(64);
const release = { version: '0.1.0', androidVersionCode: 1, iosBuildNumber: '1', expoOwner: 'test', expoProjectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', serverUrl: 'https://test.invalid' };
let plan: ReleasePlan, build: any, baseline: NativeBuildBaseline, submissions: any[], operations: Map<string, Operation<any>>, journal: Journal;
let starts: number, loseResponse: boolean;
beforeEach(() => {
  vi.resetAllMocks(); starts = 0; loseResponse = false; submissions = []; operations = new Map();
  plan = planRelease({ runId: '123', source: commit, profile: 'internal', bump: 'patch', nativeRelease: release, serverVersion: '0.2.0', inputs: { server: 's', bundle: { android: 'a', ios: 'i' }, native: { android: compatibility, ios: compatibility }, environmentHash } });
  build = { id: '12345678-1234-1234-1234-123456789abc', status: 'FINISHED', platform: 'ANDROID', gitCommitHash: commit, buildProfile: 'internal', distribution: 'INTERNAL', app: { id: release.expoProjectId }, appIdentifier: 'net.darkmachines.littlesay', appVersion: plan.nativeRelease.version, appBuildVersion: '2', runtime: { version: plan.nativeRelease.version }, updateChannel: { name: 'internal' }, fingerprint: { hash: fingerprint }, artifacts: { applicationArchiveUrl: 'https://example.invalid/artifact.apk' }, message: 'little-say:123:build:android' };
  baseline = { schema: 2, platform: 'android', profile: 'internal', channel: 'internal', environment: 'preview', commit, release: plan.nativeRelease, runtimeVersion: plan.nativeRelease.version, fingerprint, compatibility, environmentHash, buildId: build.id, artifactUrl: build.artifacts.applicationArchiveUrl, artifactSha256: 'e'.repeat(64) };
  journal = {
    operation: (key: string) => operations.get(key),
    save: (state: Omit<Operation<any>, 'sequence' | 'schema'>) => { const saved = { ...structuredClone(state), schema: 1 as const, sequence: (operations.get(state.key)?.sequence || 0) + 1 }; operations.set(state.key, saved); return saved; },
  } as Journal;
  vi.mocked(cleanCommit).mockReturnValue(commit);
  vi.mocked(expoEnvironment).mockResolvedValue({ env: { LITTLE_SAY_CHANNEL: 'internal', EXPO_NO_DOTENV: '1', CI: '1' }, hash: environmentHash });
  vi.mocked(nativeFingerprint).mockImplementation((_p, _env, normalized) => normalized ? compatibility : fingerprint);
  vi.mocked(readJson).mockImplementation((path: string) => {
    if (path.endsWith('release-policy.json')) return { schema: 1, retiredRuntimes: [] };
    const config = JSON.parse(readFileSync(path, 'utf8')); config.submit.production.ios.ascAppId = '12345'; return config;
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('signed artifact')));
  vi.mocked(buildWithSubmissions).mockImplementation(async () => ({ ...build, submissions }));
  vi.mocked(eas).mockImplementation(args => {
    if (args[0] === 'build:list') return JSON.stringify(starts ? [build] : []);
    if (args[0] === 'build:view') return JSON.stringify(build);
    if (args[0] === 'build') { starts++; if (loseResponse) throw Error('response lost'); return JSON.stringify([build]); }
    if (args[0] === 'submit') { submissions.push({ id: `submission-${submissions.length + 1}`, status: 'FINISHED', platform: build.platform, app: build.app, androidConfig: { track: 'internal', releaseStatus: 'DRAFT' }, iosConfig: { ascAppIdentifier: '12345' } }); return ''; }
    throw Error(`Unexpected EAS operation ${args}`);
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('cloud builds and exact submissions', () => {
  it('requires a finished artifact and reuses its verified ID on a force-all retry', async () => {
    const first = await cloudBuild(plan, commit, 'android', journal);
    expect(first.buildId).toBe(build.id); expect(first.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await cloudBuild(plan, commit, 'android', journal)).toEqual(first); expect(starts).toBe(1);
  });
  it('recovers an accepted build after its response is lost', async () => {
    loseResponse = true; await expect(cloudBuild(plan, commit, 'android', journal)).rejects.toThrow('response lost');
    expect(operations.get('build-android')?.status).toBe('intent');
    expect((await cloudBuild(plan, commit, 'android', journal)).buildId).toBe(build.id); expect(starts).toBe(1);
  });
  it('rejects changed identity, runtime, fingerprint, unavailable artifacts, and environment drift', async () => {
    expect(() => verifyBuildIdentity({ ...build, appIdentifier: 'other' }, plan, commit, 'android')).toThrow('application');
    expect(() => verifyBuildIdentity({ ...build, runtime: { version: '999' } }, plan, commit, 'android')).toThrow('runtime');
    build.fingerprint.hash = 'different'; await expect(cloudBuild(plan, commit, 'android', journal)).rejects.toThrow('fingerprint');
    build.fingerprint.hash = fingerprint; vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(cloudBuild(plan, commit, 'android', journal)).rejects.toThrow('unavailable'); expect(starts).toBe(1);
    vi.mocked(expoEnvironment).mockResolvedValue({ env: { LITTLE_SAY_CHANNEL: 'internal', EXPO_NO_DOTENV: '1', CI: '1' }, hash: 'drift' }); await expect(cloudBuild(plan, commit, 'android', journal)).rejects.toThrow('environment');
  });
  it('never submits internal force-all artifacts', async () => {
    await expect(submitBuild(plan, baseline, journal)).rejects.toThrow('Internal'); expect(eas).not.toHaveBeenCalled();
  });
  it.each(['android', 'ios'] as const)('submits the exact production %s build once and reads completion', async platform => {
    plan.profile = 'production'; baseline = { ...baseline, platform, profile: 'production', channel: 'production', environment: 'production' };
    Object.assign(build, { platform: platform.toUpperCase(), buildProfile: 'production', distribution: 'STORE', updateChannel: { name: 'production' } });
    const id = await submitBuild(plan, baseline, journal);
    expect(await submitBuild(plan, baseline, journal)).toBe(id);
    const calls = vi.mocked(eas).mock.calls.filter(([args]) => args[0] === 'submit'); expect(calls).toHaveLength(1);
    expect(calls[0][0]).toEqual(['submit', '--platform', platform, '--profile', 'production', '--id', baseline.buildId, '--non-interactive', '--no-wait', '--no-auto-testflight-setup']);
  });
  it('records queued submission acceptance without claiming completion, then monitors the same exact ID', async () => {
    plan.profile = 'production'; baseline = { ...baseline, profile: 'production', channel: 'production', environment: 'production' };
    Object.assign(build, { buildProfile: 'production', distribution: 'STORE', updateChannel: { name: 'production' } });
    const original = vi.mocked(eas).getMockImplementation()!;
    vi.mocked(eas).mockImplementation((args, env) => { const result = original(args, env); if (args[0] === 'submit') submissions.at(-1).status = 'IN_QUEUE'; return result; });
    const id = await submitBuild(plan, baseline, journal, false);
    expect(operations.get('submit-android')?.status).toBe('running');
    expect(operations.get('enqueue-submit-android')).toMatchObject({ status: 'complete', result: id });
    expect(await submitBuild(plan, baseline, journal, false)).toBe(id);
    submissions[0].status = 'FINISHED'; expect(await submitBuild(plan, baseline, journal)).toBe(id);
    expect(operations.get('submit-android')?.status).toBe('complete');
    expect(vi.mocked(eas).mock.calls.filter(([args]) => args[0] === 'submit')).toHaveLength(1);
  });

  it('blocks submission acceptance when the provider reports the wrong store destination', async () => {
    plan.profile = 'production'; baseline = { ...baseline, profile: 'production', channel: 'production', environment: 'production' };
    Object.assign(build, { buildProfile: 'production', distribution: 'STORE', updateChannel: { name: 'production' } });
    const original = vi.mocked(eas).getMockImplementation()!;
    vi.mocked(eas).mockImplementation((args, env) => { const result = original(args, env); if (args[0] === 'submit') submissions.at(-1).androidConfig.track = 'production'; return result; });
    await expect(submitBuild(plan, baseline, journal, false)).rejects.toThrow('destination');
    expect(operations.has('enqueue-submit-android')).toBe(false);
  });
});
describe('compatible OTA target proof', () => {
  it('retains older compatible runtimes, deduplicates copies, and excludes incompatible/retired targets in force-all', () => {
    const older = { ...baseline, buildId: 'older', runtimeVersion: '0.0.1', release: { ...baseline.release, version: '0.0.1' } };
    const retired = { ...older, runtimeVersion: '0.0.2' };
    vi.mocked(readJson).mockReturnValue({ schema: 1, retiredRuntimes: [{ profile: 'internal', platform: 'android', runtimeVersion: '0.0.2' }] });
    const targets = eligibleBaselines(plan, [baseline, { ...baseline, buildId: 'duplicate' }, older, retired, { ...older, runtimeVersion: '0.0.3', compatibility: 'incompatible' }]);
    expect(targets.eligible.map(b => b.runtimeVersion)).toEqual(['0.1.1', '0.0.1']); expect(targets.skipped).toHaveLength(2);
    expect(() => eligibleBaselines(plan, [baseline, { ...baseline, fingerprint: 'conflicting' }])).toThrow('conflicting');
    expect(() => eligibleBaselines(plan, [baseline, { ...baseline, fingerprint: 'conflicting', compatibility: 'incompatible' }])).toThrow('conflicting');
  });
  it('verifies export byte hashes, source, runtime, destination, and embedded project/server identity', () => {
    const payload = { launch: 'launch-sha', assets: ['asset-sha'] };
    const manifest = { launchAsset: { fileSHA256: payload.launch }, assets: [{ fileSHA256: payload.assets[0] }], extra: { expoClient: { extra: { eas: { projectId: release.expoProjectId }, serverUrl: release.serverUrl } } } };
    const update = { platform: 'android', runtime: { version: baseline.runtimeVersion }, gitCommitHash: commit, isGitWorkingTreeDirty: false, branch: { id: 'branch' }, message: 'marker', environment: 'PREVIEW', manifestFragment: JSON.stringify(manifest) };
    const args = { baseline, commit, branchId: 'branch', marker: 'marker', payload };
    expect(() => verifyUpdate(update, args)).not.toThrow();
    expect(() => verifyUpdate({ ...update, isGitWorkingTreeDirty: true }, args)).toThrow('source');
    expect(() => verifyUpdate({ ...update, branch: { id: 'different' } }, args)).toThrow('destination');
    expect(() => verifyUpdate(update, { ...args, payload: { ...payload, launch: 'tampered' } })).toThrow('payload');
    manifest.extra.expoClient.extra.serverUrl = 'https://other.invalid'; expect(() => verifyUpdate({ ...update, manifestFragment: JSON.stringify(manifest) }, args)).toThrow('server');
  });
});
