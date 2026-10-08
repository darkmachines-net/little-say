/** @file Defines portable release plans, verified artifact receipts, and recoverable operation state. */

import { assert } from './common';
import type { NativeRelease, Platform, Profile } from './native-contract';

export const platforms: Platform[] = ['android', 'ios'];
export type BuildMode = 'auto' | 'force_all';
export interface Inputs {
  server: string;
  bundle: Record<Platform, string>;
  native: Record<Platform, string>;
  environmentHash: string;
}
export interface ServerReceipt { commit: string; version: string; image: string; digest: string; input: string; }
export interface NativeBuildBaseline {
  schema: 2; commit: string; platform: Platform; profile: Profile; channel: Profile; environment: string;
  release: NativeRelease; runtimeVersion: string; fingerprint: string; compatibility: string; environmentHash: string;
  buildId: string; artifactUrl: string; artifactSha256: string; submissionId?: string;
}
export interface OtaReceipt { commit: string; platform: Platform; runtimeVersion: string; group: string; input: string; payloadHash: string; }
export interface OtaTarget { platform: Platform; runtimeVersion: string; buildId?: string; eligible: boolean; reason: string; }
export interface RetiredRuntime { profile: Profile; platform: Platform; runtimeVersion: string; }
export interface ReleasePlan {
  schema: 1; runId: string; source: string; mode: BuildMode; profile: Profile; bump: string; inputs: Inputs;
  server: boolean; native: Platform[]; submissions: Platform[]; ota: Platform[]; reasons: string[];
  serverVersion: string; nativeRelease: NativeRelease;
  previousServer?: ServerReceipt; baselines: NativeBuildBaseline[]; previousOta: OtaReceipt[];
  comparisons: { clientRunId?: string; serverCommit?: string; nativeBuildIds: Partial<Record<Platform, string>> };
  changes: { server: boolean; native: Platform[]; bundle: Platform[] };
  otaTargets: OtaTarget[];
  channelBranch?: { id: string; name: string };
}
export interface PreparedRelease { commit: string; candidate: string; tree: string; }
export interface ReleaseReceipt {
  schema: 1; runId: string; profile: Profile; commit: string; completedAt: string;
  plan: ReleasePlan; prepared: PreparedRelease; server?: ServerReceipt;
  baselines: NativeBuildBaseline[]; ota: OtaReceipt[];
}
export interface Operation<T = unknown> {
  schema: 1; key: string; sequence: number; status: 'intent' | 'running' | 'failed' | 'complete';
  ids: string[]; result?: T;
}

/** Require a full source revision before passing persisted data to Git or checkout. */
export function assertCommit(commit: string): void { assert(/^[a-f0-9]{40}$/.test(commit), 'Invalid release commit.'); }

/** Validate portable build proof; a runtime string or an EAS build URL alone is insufficient. */
export function validateCloudBaseline(b: NativeBuildBaseline): void {
  assert(b?.schema === 2 && platforms.includes(b.platform) && ['internal', 'production'].includes(b.profile), 'Invalid cloud baseline.');
  assertCommit(b.commit);
  assert(b.channel === b.profile && b.environment === (b.profile === 'internal' ? 'preview' : 'production'), 'Baseline channel/environment differs.');
  assert(b.runtimeVersion === b.release?.version && /^[a-f0-9]{40,64}$/.test(b.fingerprint) && /^[a-f0-9]{40,64}$/.test(b.compatibility), 'Missing native compatibility proof.');
  assert(/^[a-f0-9]{64}$/.test(b.environmentHash) && /^[a-f0-9]{64}$/.test(b.artifactSha256), 'Missing artifact/environment proof.');
  assert(/^[a-f0-9-]{36}$/.test(b.buildId) && new URL(b.artifactUrl).protocol === 'https:', 'Invalid EAS artifact identity.');
}

/** Derive a bounded asset key for one platform/runtime without trusting runtime text as a path. */
export function runtimeKey(platform: Platform, runtime: string): string {
  assert(platforms.includes(platform) && /^\d+\.\d+\.\d+$/.test(runtime), 'Invalid platform/runtime.');
  return `${platform}-${runtime}`;
}
