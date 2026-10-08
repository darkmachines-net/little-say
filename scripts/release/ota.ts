/** @file Exports and publishes only fingerprint-compatible runtime bundles, verifying their uploaded payload hashes. */

import { resolve, relative, isAbsolute } from 'node:path';
import { assert, cleanCommit, readJson, root, sha256 } from './common';
import { type NativeBuildBaseline, type OtaReceipt, type ReleasePlan, runtimeKey } from './contract';
import { channelBranch, eas, expoEnvironment, exportBundle, otaEnvironment, updateGroup, updateGroups } from './expo';
import { hash } from './inputs';
import { Journal } from './journal';
import type { Platform } from './native-contract';
import { runOperation } from './operation';

/** Fingerprint the exported JavaScript and assets exactly as the pinned EAS manifest represents them. */
export function bundlePayload(directory: string, platform: Platform): { launch: string; assets: string[] } {
  const metadata = readJson(resolve(directory, 'metadata.json')).fileMetadata[platform];
  assert(metadata?.bundle && Array.isArray(metadata.assets), 'Missing exported platform metadata.');
  const fileHash = (path: string) => {
    const file = resolve(directory, path); const rel = relative(directory, file);
    assert(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Exported asset escapes its directory.');
    return Buffer.from(sha256(file), 'hex').toString('base64url');
  };
  return { launch: fileHash(metadata.bundle), assets: [...new Set<string>(metadata.assets.map((a: any) => fileHash(a.path)))].sort() };
}

/** Check uploaded manifest bytes against the validated export, including the embedded server/project identity. */
export function verifyUpdate(update: any, args: { baseline: Pick<NativeBuildBaseline, 'platform' | 'runtimeVersion' | 'environment' | 'release'>; commit: string; branchId: string; marker: string; payload: ReturnType<typeof bundlePayload> }): void {
  const { baseline: b } = args;
  assert(update.platform === b.platform && update.runtime?.version === b.runtimeVersion && update.gitCommitHash === args.commit && update.isGitWorkingTreeDirty === false, 'OTA source/platform/runtime differs.');
  assert(update.branch?.id === args.branchId && update.message === args.marker && update.environment?.toLowerCase() === b.environment, 'OTA destination/environment differs.');
  const manifest = JSON.parse(update.manifestFragment);
  const actual = { launch: manifest.launchAsset?.fileSHA256, assets: [...new Set<string>((manifest.assets || []).map((a: any) => a.fileSHA256))].sort() };
  assert(hash(actual) === hash(args.payload), 'Uploaded OTA payload differs from the verified export.');
  assert(manifest.extra?.expoClient?.extra?.eas?.projectId === b.release.expoProjectId && manifest.extra.expoClient.extra.serverUrl === b.release.serverUrl, 'OTA manifest project/server differs.');
}

/** Select supported current-profile runtimes; incompatible fingerprints are skipped, but corrupted baseline proof fails. */
export function eligibleBaselines(plan: ReleasePlan, baselines: NativeBuildBaseline[]): { eligible: NativeBuildBaseline[]; skipped: string[] } {
  const policy = readJson(resolve(root, 'release-policy.json'));
  assert(policy.schema === 1 && Array.isArray(policy.retiredRuntimes), 'Invalid runtime support policy.');
  const candidates = new Map<string, NativeBuildBaseline>(); const proofs = new Map<string, NativeBuildBaseline>(); const skipped: string[] = [];
  for (const b of baselines) {
    if (b.profile !== plan.profile || !plan.ota.includes(b.platform)) continue;
    const key = runtimeKey(b.platform, b.runtimeVersion);
    if (policy.retiredRuntimes.some((r: any) => r.profile === b.profile && r.platform === b.platform && r.runtimeVersion === b.runtimeVersion)) { skipped.push(`${key}: retired`); continue; }
    const proof = proofs.get(key);
    assert(!proof || proof.fingerprint === b.fingerprint && proof.environmentHash === b.environmentHash, 'One runtime has conflicting native fingerprints/environment. Retire or reconcile it before OTA.');
    proofs.set(key, b);
    if (b.compatibility !== plan.inputs.native[b.platform] || b.environmentHash !== plan.inputs.environmentHash) { skipped.push(`${key}: incompatible native inputs/environment`); continue; }
    candidates.set(key, b);
  }
  return { eligible: [...candidates.values()], skipped };
}

/** Publish one validated export per supported platform/runtime, reconciling lost update responses by operation marker. */
export async function publishOta(plan: ReleasePlan, commit: string, baselines: NativeBuildBaseline[], journal: Journal): Promise<{ receipts: OtaReceipt[]; skipped: string[] }> {
  const remote = await expoEnvironment(plan.profile);
  assert(remote.hash === plan.inputs.environmentHash, 'Environment changed before OTA.');
  const branch = await channelBranch(plan.profile);
  assert(branch.id === plan.channelBranch?.id && branch.name === plan.channelBranch.name, 'Channel mapping differs from the planned destination.');
  const { eligible, skipped } = eligibleBaselines(plan, baselines);
  const receipts: OtaReceipt[] = [];
  for (const b of eligible) {
    const key = runtimeKey(b.platform, b.runtimeVersion);
    const previous = plan.previousOta.find(o => o.platform === b.platform && o.runtimeVersion === b.runtimeVersion);
    const env = otaEnvironment(b, plan.profile, remote);
    const directory = resolve(root, 'artifacts', 'release', plan.runId, 'ota', key);
    exportBundle(b.platform, directory, env);
    const payload = bundlePayload(directory, b.platform);
    assert(cleanCommit() === commit && (await expoEnvironment(plan.profile)).hash === remote.hash, 'Source/environment changed during export.');
    if (plan.mode === 'auto' && previous?.input === plan.inputs.bundle[b.platform]) {
      const updates = await updateGroup(previous.group);
      assert(updates.length === 1 && updates[0].group === previous.group && hash(payload) === previous.payloadHash, 'Previously published OTA receipt/payload differs.');
      verifyUpdate(updates[0], { baseline: b, commit: previous.commit, branchId: branch.id, marker: updates[0].message, payload });
      assert((await channelBranch(plan.profile)).id === branch.id, 'Channel mapping changed during OTA readback.');
      receipts.push(previous); continue;
    }
    const marker = `little-say:${plan.runId}:ota:${key}:${hash(payload)}`;
    const args = { baseline: b, commit, branchId: branch.id, marker, payload };
    const receipt = await runOperation(journal, `ota-${key}`, {
      async find() {
        const ids: string[] = [];
        for (let offset = 0; ; offset += 50) {
          const page = await updateGroups(branch.name, b.platform, b.runtimeVersion, offset);
          assert(Array.isArray(page), 'Unexpected EAS update list.');
          ids.push(...page.filter(group => group.length === 1 && group[0].message === marker).map(group => group[0].group));
          if (page.length < 50) return ids;
        }
      },
      async start() {
        assert((await channelBranch(plan.profile)).id === branch.id, 'Channel mapping changed before OTA.');
        const updates = JSON.parse(eas(['update', '--branch', branch.name, '--environment', b.environment, '--platform', b.platform, '--message', marker, '--input-dir', directory, '--skip-bundler', '--non-interactive', '--json'], env));
        assert(Array.isArray(updates) && updates.length === 1 && typeof updates[0].group === 'string', 'Update response is ambiguous. Reconcile before retrying.'); return updates[0].group;
      },
      async status() { return 'complete'; },
      async verify(group) {
        const updates = await updateGroup(group);
        assert(updates.length === 1 && updates[0].group === group, 'Unexpected OTA group contents.'); verifyUpdate(updates[0], args);
        assert((await channelBranch(plan.profile)).id === branch.id, 'Channel mapping changed during OTA.');
        return { commit, platform: b.platform, runtimeVersion: b.runtimeVersion, group, input: plan.inputs.bundle[b.platform], payloadHash: hash(payload) };
      },
    });
    receipts.push(receipt);
  }
  for (const platform of plan.ota) if (!eligible.some(b => b.platform === platform)) skipped.push(`${platform}: no supported compatible runtime`);
  return { receipts, skipped };
}
