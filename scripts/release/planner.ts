/** @file Selects releases from verified component baselines and allocates versions exactly once per cut. */

import { assert } from './common';
import { platforms, type Inputs, type NativeBuildBaseline, type OtaTarget, type ReleasePlan, type ReleaseReceipt, type RetiredRuntime, type ServerReceipt } from './contract';
import type { NativeRelease, Platform, Profile } from './native-contract';
import { bump } from './version';
import { nextReservedVersion, selectComponents } from '../../tools/release-engine/index.mjs';

/** Detect required artifacts and allocate the requested increment only to components needing a release; saved plans are never replanned. */
export function planRelease(args: {
  runId: string; source: string; profile: Profile; bump: string; inputs: Inputs;
  serverVersion: string; nativeRelease: NativeRelease; previous?: ReleaseReceipt; server?: ServerReceipt;
  imported?: NativeBuildBaseline[];
  retired?: RetiredRuntime[];
  resolveRuntime?: (platform: Platform, release: NativeRelease) => string;
}): ReleasePlan {
  assert(['internal', 'production'].includes(args.profile), 'Unknown release profile.');
  bump(args.serverVersion, args.bump);
  const baselines = [...new Map([...(args.imported || []), ...(args.previous?.baselines || [])].filter(b => b.profile === args.profile).map(b => [b.buildId, b])).values()];
  const reasons: string[] = [];
  const components = selectComponents({ components: [
    { id: 'server', kind: 'server', identity: args.inputs.server, baselineIdentity: args.server?.input },
    ...platforms.flatMap(platform => {
      const latest = baselines.filter(b => b.platform === platform).at(-1);
      return [
        { id: `native.${platform}`, kind: 'native', identity: `${args.inputs.native[platform]}:${args.inputs.environmentHash}`, baselineIdentity: latest && (!args.resolveRuntime || latest.schema === 3) ? `${latest.compatibility}:${latest.environmentHash}` : undefined },
        { id: `ota.${platform}`, kind: 'ota', identity: args.inputs.bundle[platform], baselineIdentity: args.previous?.plan.inputs.bundle[platform] },
      ];
    }),
  ] });
  const server = components.selected.includes('server');
  reasons.push(`server: ${server ? 'changed inputs or missing verified image' : 'unchanged verified image'}`);
  const native: Platform[] = platforms.filter(platform => {
    const needed = components.selected.includes(`native.${platform}`);
    reasons.push(`${platform} build: ${needed ? 'changed native inputs/environment or missing baseline' : 'unchanged native inputs'}`);
    return needed;
  });
  const ota = platforms.filter(platform => {
    const changed = components.selected.includes(`ota.${platform}`);
    const newRuntime = !!args.resolveRuntime && native.includes(platform);
    reasons.push(`${platform} OTA: ${newRuntime ? 'new native runtime requires its current bundle' : changed ? 'changed bundle; eligible runtimes only' : 'unchanged bundle'}`);
    return changed || newRuntime;
  });
  const release = structuredClone(args.nativeRelease);
  if (native.length) {
    release.version = bump(release.version, args.bump);
    if (native.includes('android')) release.androidVersionCode = nextReservedVersion({ after: release.androidVersionCode });
    if (native.includes('ios')) release.iosBuildNumber = String(nextReservedVersion({ after: Number(release.iosBuildNumber) }));
  }
  const runtimes = args.resolveRuntime ? Object.fromEntries(platforms.map(platform => [platform, args.resolveRuntime!(platform, release)])) as Record<Platform, string> : undefined;
  const otaTargets: OtaTarget[] = baselines.filter(b => ota.includes(b.platform)).map(b => {
    const retired = args.retired?.some(r => r.profile === args.profile && r.platform === b.platform && r.runtimeVersion === b.runtimeVersion);
    const compatible = (!args.resolveRuntime || b.schema === 3) && b.compatibility === args.inputs.native[b.platform] && b.environmentHash === args.inputs.environmentHash;
    return { platform: b.platform, runtimeVersion: b.runtimeVersion, buildId: b.buildId, eligible: !retired && compatible, reason: retired ? 'retired by committed policy' : compatible ? 'supported compatible baseline' : 'incompatible native inputs/environment' };
  });
  for (const platform of native.filter(p => ota.includes(p))) otaTargets.push({ platform, runtimeVersion: runtimes?.[platform] || release.version, eligible: true, reason: 'new build in this run' });
  reasons.push(args.profile === 'production' && native.length ? `submit: exact successful ${native.join(', ')} build IDs` : 'submit: skipped');
  return structuredClone({ schema: args.resolveRuntime ? 2 : 1, ...(runtimes ? { runtimes, policy: { runtime: 'fingerprint', deployment: 'changed-server', submission: 'enqueue-before-ota', inputVersion: 1 } } : {}), runId: args.runId, source: args.source, mode: 'auto', profile: args.profile, bump: args.bump,
    inputs: args.inputs, server, native, submissions: args.profile === 'production' ? [...native] : [], ota, reasons, serverVersion: server ? bump(args.serverVersion, args.bump) : args.serverVersion,
    nativeRelease: release, previousServer: args.server, baselines, previousOta: args.previous?.ota || [], otaTargets,
    comparisons: { clientRunId: args.previous?.runId, serverCommit: args.server?.commit, nativeBuildIds: Object.fromEntries(platforms.map(p => [p, baselines.filter(b => b.platform === p).at(-1)?.buildId])) },
    changes: { server: args.server?.input !== args.inputs.server,
      native: [...native],
      bundle: platforms.filter(p => args.previous?.plan.inputs.bundle[p] !== args.inputs.bundle[p]) } });
}

/** Decide whether there is any selected operation; an unchanged automatic cut is a true no-op. */
export function hasWork(plan: ReleasePlan): boolean { return plan.server || plan.native.length > 0 || plan.otaTargets.some(t => t.eligible); }
