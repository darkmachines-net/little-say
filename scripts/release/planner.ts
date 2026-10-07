/** @file Selects releases from verified component baselines and allocates versions exactly once per cut. */

import { assert } from './common';
import { platforms, type BuildMode, type Inputs, type NativeBuildBaseline, type OtaTarget, type ReleasePlan, type ReleaseReceipt, type RetiredRuntime, type ServerReceipt } from './contract';
import type { NativeRelease, Platform, Profile } from './native-contract';
import { bump } from './version';

/** Build an immutable plan; force bypasses change detection but never runtime compatibility or profile boundaries. */
export function planRelease(args: {
  runId: string; source: string; mode: BuildMode; profile: Profile; bump: string; inputs: Inputs;
  serverVersion: string; nativeRelease: NativeRelease; previous?: ReleaseReceipt; server?: ServerReceipt;
  imported?: NativeBuildBaseline[];
  retired?: RetiredRuntime[];
}): ReleasePlan {
  assert(['auto', 'force_all'].includes(args.mode) && ['internal', 'production'].includes(args.profile), 'Unknown release mode/profile.');
  bump(args.serverVersion, args.bump);
  const force = args.mode === 'force_all';
  const baselines = [...new Map([...(args.imported || []), ...(args.previous?.baselines || [])].filter(b => b.profile === args.profile).map(b => [b.buildId, b])).values()];
  const reasons: string[] = [];
  const server = force || args.server?.input !== args.inputs.server;
  reasons.push(`server: ${force ? 'forced' : server ? 'changed inputs or missing verified image' : 'unchanged verified image'}`);
  const native: Platform[] = platforms.filter(platform => {
    const known = baselines.filter(b => b.platform === platform);
    const latest = known.at(-1);
    const needed = force || !latest || latest.compatibility !== args.inputs.native[platform] || latest.environmentHash !== args.inputs.environmentHash;
    reasons.push(`${platform} build: ${force ? 'forced' : needed ? 'changed native inputs/environment or missing baseline' : 'unchanged native inputs'}`);
    return needed;
  });
  const ota = platforms.filter(platform => {
    const changed = force || args.previous?.plan.inputs.bundle[platform] !== args.inputs.bundle[platform];
    reasons.push(`${platform} OTA: ${force ? 'forced; eligible runtimes only' : changed ? 'changed bundle; eligible runtimes only' : 'unchanged bundle'}`);
    return changed;
  });
  const release = structuredClone(args.nativeRelease);
  if (native.length) {
    release.version = bump(release.version, 'patch');
    if (native.includes('android')) release.androidVersionCode++;
    if (native.includes('ios')) release.iosBuildNumber = String(Number(release.iosBuildNumber) + 1);
  }
  const otaTargets: OtaTarget[] = baselines.filter(b => ota.includes(b.platform)).map(b => {
    const retired = args.retired?.some(r => r.profile === args.profile && r.platform === b.platform && r.runtimeVersion === b.runtimeVersion);
    const compatible = b.compatibility === args.inputs.native[b.platform] && b.environmentHash === args.inputs.environmentHash;
    return { platform: b.platform, runtimeVersion: b.runtimeVersion, buildId: b.buildId, eligible: !retired && compatible, reason: retired ? 'retired by committed policy' : compatible ? 'supported compatible baseline' : 'incompatible native inputs/environment' };
  });
  for (const platform of native.filter(p => ota.includes(p))) otaTargets.push({ platform, runtimeVersion: release.version, eligible: true, reason: 'new build in this run' });
  reasons.push(args.profile === 'production' && native.length ? `submit: exact successful ${native.join(', ')} build IDs` : 'submit: skipped');
  return structuredClone({ schema: 1, runId: args.runId, source: args.source, mode: args.mode, profile: args.profile, bump: args.bump,
    inputs: args.inputs, server, native, submissions: args.profile === 'production' ? [...native] : [], ota, reasons, serverVersion: server ? bump(args.serverVersion, args.bump) : args.serverVersion,
    nativeRelease: release, previousServer: args.server, baselines, previousOta: args.previous?.ota || [], otaTargets,
    comparisons: { clientRunId: args.previous?.runId, serverCommit: args.server?.commit, nativeBuildIds: Object.fromEntries(platforms.map(p => [p, baselines.filter(b => b.platform === p).at(-1)?.buildId])) },
    changes: { server: args.server?.input !== args.inputs.server,
      native: platforms.filter(p => { const b = baselines.filter(b => b.platform === p).at(-1); return !b || b.compatibility !== args.inputs.native[p] || b.environmentHash !== args.inputs.environmentHash; }),
      bundle: platforms.filter(p => args.previous?.plan.inputs.bundle[p] !== args.inputs.bundle[p]) } });
}

/** Decide whether there is any selected operation; an unchanged automatic cut is a true no-op. */
export function hasWork(plan: ReleasePlan): boolean { return plan.server || plan.native.length > 0 || plan.otaTargets.some(t => t.eligible); }
