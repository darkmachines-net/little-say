/** @file Runs resumable EAS cloud builds and exact-ID submissions, retaining verified portable native baselines. */

import { createHash } from 'node:crypto';
import { assert, cleanCommit, mobile, readJson } from './common';
import { resolve } from 'node:path';
import type { NativeBuildBaseline, ReleasePlan } from './contract';
import type { Platform } from './native-contract';
import { profileConfig } from './native-contract';
import { buildWithSubmissions, eas, expoEnvironment, nativeFingerprint } from './expo';
import { Journal } from './journal';
import { runOperation } from './operation';

/** Verify EAS-reported build identity before accepting either a new build or an existing recovery match. */
export function verifyBuildIdentity(build: any, plan: ReleasePlan, commit: string, platform: Platform): void {
  assert(build.gitCommitHash === commit && build.platform?.toLowerCase() === platform && build.buildProfile === plan.profile, 'EAS build source/platform/profile differs.');
  assert(build.app?.id === plan.nativeRelease.expoProjectId && build.appIdentifier === 'net.darkmachines.littlesay', 'EAS build application differs.');
  assert(build.appVersion === plan.nativeRelease.version && String(build.appBuildVersion) === String(platform === 'android' ? plan.nativeRelease.androidVersionCode : plan.nativeRelease.iosBuildNumber), 'EAS build version differs.');
  assert(build.runtime?.version === plan.nativeRelease.version && build.updateChannel?.name === plan.profile, 'EAS build runtime/channel differs.');
  assert(build.distribution === (plan.profile === 'internal' ? 'INTERNAL' : 'STORE') && !build.isForIosSimulator, 'EAS distribution differs.');
}

/** Read and hash the exact downloadable artifact, proving availability rather than trusting a queued build URL. */
export async function artifactHash(url: string): Promise<string> {
  assert(new URL(url).protocol === 'https:', 'Artifact URL must use HTTPS.');
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  assert(response.ok && response.body, 'EAS build artifact is unavailable.');
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of response.body as any) { hash.update(chunk); bytes += chunk.length; }
  assert(bytes > 0, 'EAS artifact is empty.'); return hash.digest('hex');
}

/** Build one selected platform remotely, reconciling creation timeouts by exact release marker and source. */
export async function cloudBuild(plan: ReleasePlan, commit: string, platform: Platform, journal: Journal): Promise<NativeBuildBaseline> {
  const remote = await expoEnvironment(plan.profile);
  assert(remote.hash === plan.inputs.environmentHash && cleanCommit() === commit, 'Source/environment changed before build.');
  const compatibility = nativeFingerprint(platform, remote.env, true);
  assert(compatibility === plan.inputs.native[platform], 'Native inputs changed after planning.');
  const fingerprint = nativeFingerprint(platform, remote.env);
  const marker = `little-say:${plan.runId}:build:${platform}`;
  const view = (id: string) => JSON.parse(eas(['build:view', id, '--json'], remote.env));
  return runOperation(journal, `build-${platform}`, {
    async find() {
      const ids: string[] = [];
      for (let offset = 0; ; offset += 50) {
        const page = JSON.parse(eas(['build:list', '--platform', platform, '--build-profile', plan.profile, '--git-commit-hash', commit, '--offset', String(offset), '--limit', '50', '--json', '--non-interactive'], remote.env));
        assert(Array.isArray(page), 'Unexpected EAS build list.');
        ids.push(...page.filter((b: any) => b.message === marker).map((b: any) => b.id));
        if (page.length < 50) return ids;
      }
    },
    async start() {
      const builds = JSON.parse(eas(['build', '--platform', platform, '--profile', plan.profile, '--message', marker, '--non-interactive', '--freeze-credentials', '--no-wait', '--json'], remote.env));
      assert(Array.isArray(builds) && builds.length === 1 && typeof builds[0].id === 'string', 'EAS did not return one build ID. Reconcile before retrying.');
      return builds[0].id;
    },
    async status(id) { const b = view(id); return b.status === 'FINISHED' ? 'complete' : ['ERRORED', 'CANCELED'].includes(b.status) ? 'failed' : 'running'; },
    async verify(id) {
      const b = view(id); verifyBuildIdentity(b, plan, commit, platform);
      assert(b.status === 'FINISHED' && b.fingerprint?.hash === fingerprint, 'Cloud native fingerprint differs or build is unfinished.');
      const artifactUrl = b.artifacts?.applicationArchiveUrl || b.artifacts?.buildUrl;
      const artifactSha256 = await artifactHash(artifactUrl);
      const previous = journal.operation<NativeBuildBaseline>(`build-${platform}`)?.result;
      if (previous) assert(previous.artifactSha256 === artifactSha256, 'Previously verified build artifact changed.');
      assert((await expoEnvironment(plan.profile)).hash === remote.hash && cleanCommit() === commit, 'Build environment/source changed during execution.');
      return { schema: 2, commit, platform, profile: plan.profile, channel: plan.profile, environment: profileConfig(plan.profile).environment,
        release: plan.nativeRelease, runtimeVersion: plan.nativeRelease.version, fingerprint, compatibility, environmentHash: remote.hash, buildId: id, artifactUrl, artifactSha256 };
    },
  });
}

/** Submit only a production build's exact ID, discovering submission IDs via the pinned EAS read adapter. */
export async function submitBuild(plan: ReleasePlan, baseline: NativeBuildBaseline, journal: Journal): Promise<string> {
  assert(plan.profile === 'production' && baseline.profile === 'production', 'Internal artifacts cannot be submitted.');
  const config = readJson(resolve(mobile, 'eas.json')).submit.production;
  assert(config.android.track === 'internal' && config.android.releaseStatus === 'draft', 'Production Android submissions must remain internal drafts.');
  const remote = await expoEnvironment(plan.profile);
  assert(remote.hash === baseline.environmentHash, 'Submission environment differs.');
  const submissions = async () => {
    const build = await buildWithSubmissions(baseline.buildId); verifyBuildIdentity(build, plan, baseline.commit, baseline.platform);
    assert(build.status === 'FINISHED' && build.fingerprint?.hash === baseline.fingerprint, 'Submission build is not the verified successful artifact.');
    return build.submissions as any[];
  };
  return runOperation(journal, `submit-${baseline.platform}`, {
    async find() { return (await submissions()).map(s => s.id); },
    async start() {
      eas(['submit', '--platform', baseline.platform, '--profile', 'production', '--id', baseline.buildId, '--non-interactive', '--no-wait', '--no-auto-testflight-setup'], remote.env);
      const used = journal.operation(`submit-${baseline.platform}`)?.ids || [];
      const matches = (await submissions()).filter(s => !used.includes(s.id));
      assert(matches.length === 1, 'Cannot identify accepted EAS submission. Reconcile before retrying.'); return matches[0].id;
    },
    async status(id) { const s = (await submissions()).find(s => s.id === id); assert(s, 'Submission no longer belongs to the recorded build.'); return s.status === 'FINISHED' ? 'complete' : ['ERRORED', 'CANCELED'].includes(s.status) ? 'failed' : 'running'; },
    async verify(id) {
      const s = (await submissions()).find(s => s.id === id);
      assert(s?.status === 'FINISHED' && s.platform.toLowerCase() === baseline.platform && s.app.id === baseline.release.expoProjectId, 'Submission readback differs.');
      if (baseline.platform === 'android') assert(s.androidConfig?.track === 'internal' && s.androidConfig?.releaseStatus?.toLowerCase() === 'draft', 'Play submission destination differs.');
      else assert(String(s.iosConfig?.ascAppIdentifier) === String(config.ios.ascAppId), 'App Store Connect destination differs.');
      return id;
    },
  });
}
