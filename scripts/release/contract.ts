/** @file Defines portable release plans, verified artifact receipts, and recoverable operation state. */

import { assert } from './common';
import type { NativeRelease, Platform, Profile } from './native-contract';
import type { EnginePlan, OperationEvidence, ReleaseGraph, SourceIdentity } from '../../tools/release-engine/index.mjs';

export const platforms: Platform[] = ['android', 'ios'];
/** Persisted modes remain readable for historical receipts and retries; new plans always use auto. */
export type BuildMode = 'auto' | 'force_all';
export interface Inputs {
  server: string;
  bundle: Record<Platform, string>;
  native: Record<Platform, string>;
  environmentHash: string;
}
export interface ServerReceipt { commit: string; version: string; image: string; digest: string; input: string; }
export interface NativeBuildBaseline {
  schema: 2 | 3; commit: string; platform: Platform; profile: Profile; channel: Profile; environment: string;
  runtimePolicy?: 'fingerprint';
  release: NativeRelease; runtimeVersion: string; fingerprint: string; compatibility: string; environmentHash: string;
  buildId: string; artifactUrl: string; artifactSha256: string; submissionId?: string;
}
export interface OtaReceipt { commit: string; platform: Platform; runtimeVersion: string; group: string; input: string; payloadHash: string; }
export interface OtaTarget { platform: Platform; runtimeVersion: string; buildId?: string; eligible: boolean; reason: string; }
export interface RetiredRuntime { profile: Profile; platform: Platform; runtimeVersion: string; }
export interface ReleasePlan {
  schema: 1 | 2; runId: string; source: string; mode: BuildMode; profile: Profile; bump: string; inputs: Inputs;
  policy?: { runtime: 'fingerprint'; deployment: 'changed-server'; submission: 'enqueue-before-ota'; inputVersion: 1 };
  runtimes?: Record<Platform, string>;
  engine?: EnginePlan<{ source: SourceIdentity; graph: ReleaseGraph; decisionsDigest: string }>;
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
  retryProof?: OperationEvidence;
}

/** Require a full source revision before passing persisted data to Git or checkout. */
export function assertCommit(commit: string): void { assert(/^[a-f0-9]{40}$/.test(commit), 'Invalid release commit.'); }

/** Validate portable build proof; a runtime string or an EAS build URL alone is insufficient. */
export function validateCloudBaseline(b: NativeBuildBaseline): void {
  assert([2, 3].includes(b?.schema) && platforms.includes(b.platform) && ['internal', 'production'].includes(b.profile), 'Invalid cloud baseline.');
  assertCommit(b.commit);
  assert(b.channel === b.profile && b.environment === (b.profile === 'internal' ? 'preview' : 'production'), 'Baseline channel/environment differs.');
  assert((b.schema === 2 ? b.runtimeVersion === b.release?.version : b.runtimePolicy === 'fingerprint' && /^[a-f0-9]{40,64}$/.test(b.runtimeVersion)) && /^[a-f0-9]{40,64}$/.test(b.fingerprint) && /^[a-f0-9]{40,64}$/.test(b.compatibility), 'Missing native compatibility proof.');
  assert(/^[a-f0-9]{64}$/.test(b.environmentHash) && /^[a-f0-9]{64}$/.test(b.artifactSha256), 'Missing artifact/environment proof.');
  assert(/^[a-f0-9-]{36}$/.test(b.buildId) && new URL(b.artifactUrl).protocol === 'https:', 'Invalid EAS artifact identity.');
}

/** Derive a bounded asset key for one platform/runtime without trusting runtime text as a path. */
export function runtimeKey(platform: Platform, runtime: string): string {
  assert(platforms.includes(platform) && /^(\d+\.\d+\.\d+|[a-f0-9]{40,64})$/.test(runtime), 'Invalid platform/runtime.');
  return `${platform}-${runtime}`;
}

/** Preserve deployment requirements of saved historical cuts while new OTA-only cuts leave the server unchanged. */
export function requiresDeployment(plan: ReleasePlan): boolean { return plan.schema === 1 ? plan.server || plan.ota.length > 0 : plan.server; }

/** Resolve the immutable runtime allocated for a platform, retaining legacy appVersion records. */
export function plannedRuntime(plan: ReleasePlan, platform: Platform): string {
  const runtime = plan.schema === 2 ? plan.runtimes?.[platform] : plan.nativeRelease.version;
  assert(runtime, 'Missing planned runtime.'); runtimeKey(platform, runtime); return runtime;
}

/** Reject unsupported modern policy records without rewriting historical immutable plans. */
export function validatePlanPolicy(plan: ReleasePlan): void {
  assert([1, 2].includes(plan.schema), 'Unsupported release plan schema.');
  if (plan.schema === 1) return;
  assert(plan.policy?.runtime === 'fingerprint' && plan.policy.deployment === 'changed-server' && plan.policy.submission === 'enqueue-before-ota' && plan.policy.inputVersion === 1, 'Unsupported release plan policy.');
  for (const platform of platforms) assert(/^[a-f0-9]{40,64}$/.test(plannedRuntime(plan, platform)), 'Modern plans require resolved fingerprint runtimes.');
}
