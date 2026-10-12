/** @file Verifies finalization reads original published bytes without recompiling Hermes, while rejecting changed payloads, destinations and incomplete receipt coverage. */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readJson } from './common';
import { channelBranch, eas, expoEnvironment, exportBundle, updateAssetUrls, updateGroup } from './expo';
import { hash } from './inputs';
import { publishOta, verifyPublishedOta } from './ota';

vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), readJson: vi.fn() }));
vi.mock('./expo', () => ({ channelBranch: vi.fn(), eas: vi.fn(), expoEnvironment: vi.fn(), exportBundle: vi.fn(), otaEnvironment: vi.fn(), updateAssetUrls: vi.fn(), updateGroup: vi.fn(), updateGroups: vi.fn() }));
const commit = 'a'.repeat(40);
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const bytes = 'Hermes bytecode containing /tmp/expo-bundler-original/index.js';
let plan: any, baseline: any, update: any, saved: any, operation: any, journal: any;
beforeEach(() => {
  vi.resetAllMocks();
  plan = { runId: '123', mode: 'auto', profile: 'internal', ota: ['android'], inputs: { native: { android: 'native' }, bundle: { android: 'input' }, environmentHash: 'env' }, previousOta: [], channelBranch: { id: 'branch', name: 'internal' } };
  baseline = { platform: 'android', profile: 'internal', runtimeVersion: '0.1.3', fingerprint: 'fingerprint', compatibility: 'native', environmentHash: 'env', environment: 'preview', release: { expoProjectId: 'project', serverUrl: 'https://test.invalid' } };
  const payload = { launch: digest(bytes), assets: [digest('asset')] };
  const receipt = { commit, platform: 'android', runtimeVersion: '0.1.3', group: 'group', input: 'input', payloadHash: hash(payload) };
  operation = { status: 'complete', ids: ['group'], result: receipt }; journal = { operation: () => operation };
  saved = { receipts: [receipt], skipped: [] };
  update = { id: 'update', group: 'group', platform: 'android', runtime: { version: '0.1.3' }, gitCommitHash: commit, isGitWorkingTreeDirty: false, branch: { id: 'branch' }, environment: 'preview', message: `little-say:123:ota:android-0.1.3:${receipt.payloadHash}`,
    manifestFragment: JSON.stringify({ launchAsset: { storageKey: 'launch', fileSHA256: payload.launch }, assets: [{ storageKey: 'asset', fileSHA256: payload.assets[0] }], extra: { expoClient: { extra: { eas: { projectId: 'project' }, serverUrl: 'https://test.invalid' } } } }) };
  vi.mocked(readJson).mockReturnValue({ schema: 1, retiredRuntimes: [] });
  vi.mocked(channelBranch).mockResolvedValue(plan.channelBranch);
  vi.mocked(expoEnvironment).mockResolvedValue({ env: { LITTLE_SAY_CHANNEL: 'internal', EXPO_NO_DOTENV: '1', CI: '1' }, hash: 'env' });
  vi.mocked(updateGroup).mockImplementation(async () => [update]);
  vi.mocked(updateAssetUrls).mockResolvedValue(['launch', 'asset'].map(storageKey => ({ storageKey, url: `https://test.invalid/${storageKey}`, headers: {} })));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.endsWith('/launch') ? bytes : 'asset')));
  vi.mocked(exportBundle).mockImplementation(() => { throw Error('A new Hermes export would have a different random temporary filename'); });
});
afterEach(() => vi.unstubAllGlobals());
it('verifies the original published export without re-exporting or sending provider writes', async () => {
  await expect(verifyPublishedOta(plan, commit, [baseline], journal, saved)).resolves.toEqual(saved);
  expect(exportBundle).not.toHaveBeenCalled(); expect(eas).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(2);
});
it('reuses the completed stage on a workflow rerun without recompiling bytecode', async () => {
  journal.read = () => saved;
  await expect(publishOta(plan, commit, [baseline], journal)).resolves.toEqual(saved);
  expect(exportBundle).not.toHaveBeenCalled(); expect(eas).not.toHaveBeenCalled();
});
it('rejects changed downloaded bytes even when provider manifest hashes still match the receipt', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('changed bytes')));
  await expect(verifyPublishedOta(plan, commit, [baseline], journal, saved)).rejects.toThrow('Downloaded OTA bytes');
});
it('rejects manifest changes against the immutable publication hash', async () => {
  const manifest = JSON.parse(update.manifestFragment); manifest.launchAsset.fileSHA256 = digest('changed'); update.manifestFragment = JSON.stringify(manifest);
  await expect(verifyPublishedOta(plan, commit, [baseline], journal, saved)).rejects.toThrow('original verified receipt');
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['commit', 'branch', 'environment', 'marker'])('rejects changed OTA %s metadata', async field => {
  if (field === 'commit') update.gitCommitHash = 'b'.repeat(40);
  if (field === 'branch') update.branch.id = 'other';
  if (field === 'environment') update.environment = 'production';
  if (field === 'marker') update.message = 'unrelated upload';
  await expect(verifyPublishedOta(plan, commit, [baseline], journal, saved)).rejects.toThrow(/OTA (source|destination)/);
});
it('requires matching completed operation proof and complete runtime coverage', async () => {
  operation.status = 'running'; await expect(verifyPublishedOta(plan, commit, [baseline], journal, saved)).rejects.toThrow('completed proof');
  operation.status = 'complete'; saved.receipts = []; await expect(verifyPublishedOta(plan, commit, [baseline], journal, saved)).rejects.toThrow('coverage');
});
it('rejects missing signed asset identities and channel movement during readback', async () => {
  vi.mocked(updateAssetUrls).mockResolvedValueOnce([]);
  await expect(verifyPublishedOta(plan, commit, [baseline], journal, saved)).rejects.toThrow('download identities');
  vi.mocked(channelBranch).mockResolvedValueOnce(plan.channelBranch).mockResolvedValueOnce({ id: 'other', name: 'internal' });
  await expect(verifyPublishedOta(plan, commit, [baseline], journal, saved)).rejects.toThrow('changed during readback');
});
