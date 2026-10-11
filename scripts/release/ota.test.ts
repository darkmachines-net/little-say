/** @file Exercises historical forced OTA plans, automatic reuse, runtime deduplication, and lost-response recovery against exported bytes. */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanCommit, writeJson } from './common';
import { channelBranch, eas, expoEnvironment, exportBundle, otaEnvironment, updateGroup, updateGroups } from './expo';
import { bundlePayload, publishOta } from './ota';
import { planRelease } from './planner';
import type { NativeBuildBaseline, Operation, ReleasePlan } from './contract';
import type { Journal } from './journal';
const fixture = vi.hoisted(() => ({ root: `${process.cwd()}/artifacts/ota-unit-${process.pid}` }));
vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), root: fixture.root, cleanCommit: vi.fn() }));
vi.mock('./expo', () => ({ channelBranch: vi.fn(), eas: vi.fn(), expoEnvironment: vi.fn(), exportBundle: vi.fn(), otaEnvironment: vi.fn(), updateGroup: vi.fn(), updateGroups: vi.fn() }));
const commit = 'a'.repeat(40), release = { version: '0.1.0', androidVersionCode: 1, iosBuildNumber: '1', expoOwner: 'test', expoProjectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', serverUrl: 'https://test.invalid' };
let plan: ReleasePlan, baselines: NativeBuildBaseline[], groups: any[], journal: Journal, operations: Map<string, Operation<any>>, loseResponse: boolean;
beforeEach(() => {
  vi.resetAllMocks(); groups = []; operations = new Map(); loseResponse = false;
  plan = planRelease({ runId: '123', source: commit, profile: 'internal', bump: 'patch', inputs: { server: 's', native: { android: 'compat', ios: 'compat' }, bundle: { android: 'bundle', ios: 'bundle' }, environmentHash: 'env' }, nativeRelease: release, serverVersion: '0.2.0' });
  plan.ota = ['android']; plan.channelBranch = { id: 'branch', name: 'internal' };
  baselines = ['0.1.0', '0.1.1'].map(runtimeVersion => ({ schema: 2, platform: 'android', profile: 'internal', channel: 'internal', environment: 'preview', commit, release: { ...release, version: runtimeVersion }, runtimeVersion, fingerprint: 'fingerprint', compatibility: 'compat', environmentHash: 'env', buildId: runtimeVersion, artifactUrl: 'https://example.invalid/app', artifactSha256: 'hash' }));
  journal = { operation: (key: string) => operations.get(key), save: (state: any) => { const value = { ...state, schema: 1, sequence: (operations.get(state.key)?.sequence || 0) + 1 }; operations.set(state.key, value); return value; } } as unknown as Journal;
  writeJson(resolve(fixture.root, 'release-policy.json'), { schema: 1, retiredRuntimes: [] });
  vi.mocked(cleanCommit).mockReturnValue(commit);
  vi.mocked(channelBranch).mockResolvedValue(plan.channelBranch);
  vi.mocked(expoEnvironment).mockResolvedValue({ env: { LITTLE_SAY_CHANNEL: 'internal', CI: '1', EXPO_NO_DOTENV: '1' }, hash: 'env' });
  vi.mocked(otaEnvironment).mockImplementation(b => ({ TARGET_RUNTIME: b.runtimeVersion }));
  vi.mocked(exportBundle).mockImplementation((platform, directory) => {
    mkdirSync(directory, { recursive: true }); writeFileSync(resolve(directory, 'bundle.hbc'), 'real exported bundle bytes'); writeFileSync(resolve(directory, 'asset.png'), 'asset bytes');
    writeJson(resolve(directory, 'metadata.json'), { fileMetadata: { [platform]: { bundle: 'bundle.hbc', assets: [{ path: 'asset.png' }] } } });
  });
  vi.mocked(updateGroups).mockImplementation(async (_branch, _platform, runtime) => groups.filter(g => g.runtime.version === runtime).map(g => [g]));
  vi.mocked(updateGroup).mockImplementation(async id => groups.filter(g => g.group === id));
  vi.mocked(eas).mockImplementation((args, env) => {
    expect(args).toContain('--skip-bundler'); expect(args).toContain('--environment'); expect(args).not.toContain('--channel');
    const payload = bundlePayload(args[args.indexOf('--input-dir') + 1], 'android');
    const group = `group-${groups.length + 1}`;
    groups.push({ group, platform: 'android', runtime: { version: env!.TARGET_RUNTIME }, gitCommitHash: commit, isGitWorkingTreeDirty: false, branch: { id: 'branch' }, environment: 'PREVIEW', message: args[args.indexOf('--message') + 1], manifestFragment: JSON.stringify({ launchAsset: { fileSHA256: payload.launch }, assets: payload.assets.map(fileSHA256 => ({ fileSHA256 })), extra: { expoClient: { extra: { eas: { projectId: release.expoProjectId }, serverUrl: release.serverUrl } } } }) });
    if (loseResponse) { loseResponse = false; throw Error('response lost after publication'); } return JSON.stringify([{ group }]);
  });
});
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }));
describe('OTA operation recovery', () => {
  it('preserves a historical forced plan and reuses its fresh groups on retries', async () => {
    plan.mode = 'force_all';
    plan.previousOta = [{ commit, platform: 'android', runtimeVersion: '0.1.0', input: 'bundle', group: 'previous-run', payloadHash: 'old' }];
    const result = await publishOta(plan, commit, [...baselines, baselines[0]], journal);
    expect(result.receipts.map(r => r.group)).toEqual(['group-1', 'group-2']); expect(eas).toHaveBeenCalledTimes(2);
    expect(await publishOta(plan, commit, baselines, journal)).toEqual(result); expect(eas).toHaveBeenCalledTimes(2);
  });
  it('recovers a publication accepted before the response/journal ID was lost', async () => {
    loseResponse = true; await expect(publishOta(plan, commit, baselines, journal)).rejects.toThrow('response lost');
    const result = await publishOta(plan, commit, baselines, journal); expect(result.receipts).toHaveLength(2); expect(groups).toHaveLength(2);
  });
  it('automatic mode reuses unchanged groups while publishing a runtime lacking that bundle', async () => {
    const prior = (await publishOta(plan, commit, [baselines[0]], journal)).receipts[0];
    operations.clear(); vi.mocked(eas).mockClear(); plan.mode = 'auto';
    plan.previousOta = [prior]; const result = await publishOta(plan, commit, baselines, journal);
    expect(result.receipts[0]).toEqual(prior); expect(eas).toHaveBeenCalledTimes(1);
  });
  it('stops if the planned channel moves or previously verified uploaded bytes change', async () => {
    vi.mocked(channelBranch).mockResolvedValueOnce({ id: 'other', name: 'internal' }); await expect(publishOta(plan, commit, baselines, journal)).rejects.toThrow('planned destination'); expect(eas).not.toHaveBeenCalled();
    await publishOta(plan, commit, baselines, journal); groups[0].manifestFragment = '{}';
    await expect(publishOta(plan, commit, baselines, journal)).rejects.toThrow('payload'); expect(eas).toHaveBeenCalledTimes(2);
  });
});
