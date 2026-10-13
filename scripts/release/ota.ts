/** @file Exports and publishes only fingerprint-compatible runtime bundles, verifying their uploaded payload hashes. */

import { resolve, relative, isAbsolute } from 'node:path';
import { assert, cleanCommit, readJson, root, sha256 } from './common';
import { type NativeBuildBaseline, type OtaReceipt, type ReleasePlan, runtimeKey } from './contract';
import { channelBranch, eas, expoEnvironment, exportBundle, otaEnvironment, updateAssetUrls, updateGroup, updateGroups } from './expo';
import { hash } from './inputs';
import { Journal } from './journal';
import type { Platform } from './native-contract';
import { runOperation } from './operation';
import { artifactHash } from './cloud';
import { retainExport } from './ota-artifact';

export interface OtaResults { receipts: OtaReceipt[]; skipped: string[]; }

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

/** Verify the recorded export against provider metadata and every downloaded asset, without recompiling nondeterministic Hermes bytecode or publishing anything. */
export async function verifyPublishedOta(plan: ReleasePlan, commit: string, baselines: NativeBuildBaseline[], journal: Journal, saved: OtaResults): Promise<OtaResults> {
  assert(saved && Array.isArray(saved.receipts) && Array.isArray(saved.skipped), 'Missing OTA completion record.');
  assert((await expoEnvironment(plan.profile)).hash === plan.inputs.environmentHash, 'Environment changed before OTA readback.');
  const branch = await channelBranch(plan.profile);
  assert(hash(branch) === hash(plan.channelBranch), 'Channel mapping differs from the planned destination.');
  const { eligible, skipped } = eligibleBaselines(plan, baselines);
  for (const platform of plan.ota) if (!eligible.some(b => b.platform === platform)) skipped.push(`${platform}: no supported compatible runtime`);
  assert(hash(skipped) === hash(saved.skipped) && saved.receipts.length === eligible.length, 'Recorded OTA target coverage differs.');
  const visited = new Set<string>();
  for (const receipt of saved.receipts) {
    const key = runtimeKey(receipt.platform, receipt.runtimeVersion);
    const baseline = eligible.find(b => runtimeKey(b.platform, b.runtimeVersion) === key);
    assert(baseline && !visited.has(key) && receipt.input === plan.inputs.bundle[receipt.platform] && /^[a-f0-9]{64}$/.test(receipt.payloadHash), 'Recorded OTA identity/input differs.');
    visited.add(key);
    const previous = plan.previousOta.find(o => hash(o) === hash(receipt));
    const reused = plan.mode === 'auto' && previous?.input === plan.inputs.bundle[receipt.platform];
    if (!reused) {
      const operation = journal.operation<OtaReceipt>(`ota-${key}`);
      assert(operation?.status === 'complete' && operation.ids.at(-1) === receipt.group && hash(operation.result) === hash(receipt) && receipt.commit === commit, 'OTA operation lacks matching completed proof.');
    }
    const updates = await updateGroup(receipt.group);
    assert(updates.length === 1 && updates[0].group === receipt.group && !updates[0].isRollBackToEmbedded, 'Unexpected OTA group contents.');
    const update = updates[0];
    const manifest = JSON.parse(update.manifestFragment);
    const assets = [manifest.launchAsset, ...(manifest.assets || [])];
    assert(assets.every(a => a && typeof a.storageKey === 'string' && /^[A-Za-z0-9_-]{43}$/.test(a.fileSHA256)), 'Missing OTA asset identity/hash.');
    const payload = { launch: manifest.launchAsset.fileSHA256, assets: [...new Set<string>((manifest.assets || []).map((a: any) => a.fileSHA256))].sort() };
    assert(hash(payload) === receipt.payloadHash, 'Published OTA payload differs from its original verified receipt.');
    const marker = reused ? update.message : `little-say:${plan.runId}:ota:${key}:${receipt.payloadHash}`;
    verifyUpdate(update, { baseline, commit: receipt.commit, branchId: branch.id, marker, payload });
    const keys = [...new Set<string>(assets.map(a => a.storageKey))];
    const urls = await updateAssetUrls(update.id, keys);
    assert(urls.length === keys.length && new Set(urls.map(a => a.storageKey)).size === keys.length && urls.every(a => keys.includes(a.storageKey)), 'OTA asset download identities differ.');
    for (const location of urls) {
      const actual = Buffer.from(await artifactHash(location.url, location.headers), 'hex').toString('base64url');
      assert(assets.filter(a => a.storageKey === location.storageKey).every(a => a.fileSHA256 === actual), 'Downloaded OTA bytes differ from the original verified export.');
    }
  }
  assert(hash(await channelBranch(plan.profile)) === hash(branch) && (await expoEnvironment(plan.profile)).hash === plan.inputs.environmentHash, 'OTA destination/environment changed during readback.');
  return saved;
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
    if (plan.schema === 2 && b.schema !== 3 || b.compatibility !== plan.inputs.native[b.platform] || b.environmentHash !== plan.inputs.environmentHash) { skipped.push(`${key}: incompatible native inputs/environment`); continue; }
    candidates.set(key, b);
  }
  return { eligible: [...candidates.values()], skipped };
}

/** Publish one validated export per supported platform/runtime, reconciling lost update responses by operation marker. */
export async function publishOta(plan: ReleasePlan, commit: string, baselines: NativeBuildBaseline[], journal: Journal): Promise<{ receipts: OtaReceipt[]; skipped: string[] }> {
  const completed = journal.read<OtaResults>('ota.json');
  if (completed) return verifyPublishedOta(plan, commit, baselines, journal, completed);
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
    const existing = journal.operation<OtaReceipt>(`ota-${key}`);
    const retained = existing?.status === 'complete' ? existing.result : plan.mode === 'auto' && previous?.input === plan.inputs.bundle[b.platform] ? previous : undefined;
    if (retained) {
      await verifyPublishedOta({ ...plan, ota: [b.platform] }, commit, [b], journal, { receipts: [retained], skipped: [] });
      receipts.push(retained); continue;
    }
    let directory = resolve(root, 'artifacts', 'release', plan.runId, 'ota', key);
    if (plan.schema === 2) directory = await retainExport(journal, key, directory, () => exportBundle(b.platform, directory, env));
    else exportBundle(b.platform, directory, env);
    const payload = bundlePayload(directory, b.platform);
    assert(cleanCommit() === commit && (await expoEnvironment(plan.profile)).hash === remote.hash, 'Source/environment changed during export.');
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
