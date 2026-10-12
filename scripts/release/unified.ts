/** @file Coordinates protected releases, server promotion before deployment, provider jobs, and verified completion. */

import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { assert, cleanCommit, fail, git, isMain, readJson, root, writeJson } from './common';
import { assertCommit, validateCloudBaseline, type Inputs, type NativeBuildBaseline, type OtaReceipt, type PreparedRelease, type ReleasePlan, type ReleaseReceipt, type ServerReceipt } from './contract';
import { type Platform, type Profile, releaseConfig } from './native-contract';
import { hash, sourceInputs } from './inputs';
import { hasWork, planRelease } from './planner';
import { completedReceipts, gh, Journal, readAsset, releases } from './journal';
import { channelBranch, expoEnvironment, exportBundle, nativeFingerprint, otaEnvironment, preflightCredentials, versionEnvironment } from './expo';
import { prepareCandidate, validateReleaseSource } from './candidate';
import { artifactHash, cloudBuild, submitBuild, verifyBuildIdentity } from './cloud';
import { eas } from './expo';
import { checkVersions } from './version';
import { legacyImage, promoteImage, publishImage, verifyImage } from './image';
import { publishOta } from './ota';
import { StaleCandidateError } from './metadata';
import { reconcileCandidates, retireCandidate } from './retirement';
import { releaseSummary } from './summary';

function summary(message: string) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n\n`);
}
function output(key: string, value: unknown) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
}
function ancestor(before: string, after: string) {
  assertCommit(before); assertCommit(after); git(['merge-base', '--is-ancestor', before, after]);
}
function history(source: string): ReleaseReceipt[] {
  const receipts = completedReceipts();
  for (const receipt of receipts) {
    ancestor(receipt.commit, source);
    assert(git(['rev-parse', `refs/tags/release/${receipt.profile}/${receipt.runId}^{commit}`]) === receipt.commit, 'Completed release tag moved.');
  }
  return receipts.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
}
function guard(plan: ReleasePlan, prepared: PreparedRelease) {
  assert(cleanCommit() === prepared.commit && git(['rev-parse', 'HEAD^{tree}']) === prepared.tree, 'Publication checkout differs from the validated release.');
  git(['fetch', 'origin', process.env.DEFAULT_BRANCH!, '--tags']);
  ancestor(prepared.commit, git(['rev-parse', `origin/${process.env.DEFAULT_BRANCH}`]));
  // Any later completed release prevents a stale retry from changing aliases or channels.
  for (const completed of completedReceipts()) if (completed.runId !== plan.runId) ancestor(completed.commit, prepared.commit);
}
async function verifyImports(profile: Profile): Promise<NativeBuildBaseline[]> {
  const policy = readJson(resolve(root, 'release-policy.json'));
  assert(policy.schema === 1 && Array.isArray(policy.importedBaselines), 'Invalid release support policy.');
  const imported: NativeBuildBaseline[] = policy.importedBaselines.filter((b: NativeBuildBaseline) => b.profile === profile);
  for (const b of imported) {
    validateCloudBaseline(b); ancestor(b.commit, cleanCommit());
    const build = JSON.parse(eas(['build:view', b.buildId, '--json']));
    verifyBuildIdentity(build, { profile, nativeRelease: b.release } as ReleasePlan, b.commit, b.platform);
    assert(build.status === 'FINISHED' && build.fingerprint?.hash === b.fingerprint, 'Imported baseline build is unverified.');
    assert(await artifactHash(build.artifacts.applicationArchiveUrl || build.artifacts.buildUrl) === b.artifactSha256, 'Imported artifact hash differs.');
  }
  return imported;
}
async function createPlan(runId: string): Promise<ReleasePlan> {
  checkVersions();
  const source = cleanCommit();
  const profile = (process.env.RELEASE_PROFILE || 'internal') as Profile;
  const remote = await expoEnvironment(profile);
  const inputs: Inputs = { server: sourceInputs(source, 'server'), bundle: { android: sourceInputs(source, 'android'), ios: sourceInputs(source, 'ios') },
    native: { android: nativeFingerprint('android', remote.env, true), ios: nativeFingerprint('ios', remote.env, true) }, environmentHash: remote.hash };
  const receipts = history(source);
  const image = `ghcr.io/${process.env.GITHUB_REPOSITORY!.toLowerCase()}`;
  const server = receipts.map(r => r.server).filter((r): r is ServerReceipt => !!r).at(-1) || legacyImage(image, source);
  if (server) assert(server.image === image && verifyImage(server.image, server.version, server.commit) === server.digest, 'Previous image receipt no longer verifies.');
  const plan = planRelease({ runId, source, profile, bump: process.env.RELEASE_BUMP || 'patch', inputs, serverVersion: readJson(resolve(root, 'release.json')).version,
    nativeRelease: releaseConfig(), previous: receipts.filter(r => r.profile === profile).at(-1), server, imported: await verifyImports(profile), retired: readJson(resolve(root, 'release-policy.json')).retiredRuntimes });
  if (plan.otaTargets.some(t => t.eligible)) plan.channelBranch = await channelBranch(profile);
  return plan;
}
async function preflight(plan: ReleasePlan, dry: boolean) {
  summary(releaseSummary(plan));
  writeJson(resolve(root, 'artifacts', 'release-plan.json'), plan);
  console.log(JSON.stringify(plan, null, 2));
  if (!hasWork(plan)) return;
  await preflightCredentials(plan.profile, plan.native);
  if (plan.otaTargets.some(t => t.eligible)) await channelBranch(plan.profile);
  const remote = await expoEnvironment(plan.profile);
  assert(remote.hash === plan.inputs.environmentHash, 'Environment changed during planning.');
  for (const target of plan.otaTargets.filter(t => t.eligible && t.buildId)) {
    const b = plan.baselines.find(b => b.buildId === target.buildId)!;
    const env = otaEnvironment(b, plan.profile, remote);
    if (dry) exportBundle(b.platform, resolve(root, 'artifacts', 'release-dry-run', `${b.platform}-${b.runtimeVersion}`), env);
  }
  if (dry) {
    validateReleaseSource();
    for (const platform of plan.native) {
      exportBundle(platform, resolve(root, 'artifacts', 'release-dry-run', platform), versionEnvironment(remote.env, plan.nativeRelease));
    }
    assert(cleanCommit() === plan.source && (await expoEnvironment(plan.profile)).hash === remote.hash, 'Dry-run source/environment changed.');
  }
}
function nativeResults(plan: ReleasePlan, journal: Journal): NativeBuildBaseline[] {
  const baselines = [...plan.baselines];
  for (const platform of plan.native) {
    const op = journal.operation<NativeBuildBaseline>(`build-${platform}`);
    assert(op?.status === 'complete' && op.result, `Missing successful ${platform} build receipt.`);
    const b = { ...op.result };
    if (plan.profile === 'production') {
      const submission = journal.operation<string>(`submit-${platform}`);
      assert(submission?.status === 'complete' && submission.result, `Missing ${platform} submission receipt.`); b.submissionId = submission.result;
    }
    baselines.push(b);
  }
  return baselines;
}
async function finalize(plan: ReleasePlan, prepared: PreparedRelease, journal: Journal) {
  const baselines = nativeResults(plan, journal);
  const ota = journal.read<{ receipts: OtaReceipt[]; skipped: string[] }>('ota.json');
  assert(!plan.ota.length || ota, 'Missing OTA completion record.');
  const server = plan.server ? journal.operation<ServerReceipt>('server')?.result : plan.previousServer;
  assert(!plan.server || journal.operation('server')?.status === 'complete' && server, 'Missing verified server publication.');
  if (server) assert(verifyImage(server.image, server.version, server.commit) === server.digest, 'Final image readback failed.');
  for (const platform of plan.native) {
    const b = await cloudBuild(plan, prepared.commit, platform, journal);
    if (plan.profile === 'production') await submitBuild(plan, b, journal);
  }
  if (plan.ota.length) {
    const verified = await publishOta(plan, prepared.commit, baselines, journal);
    assert(hash(verified) === hash(ota), 'OTA readback changed before completion.');
  }
  guard(plan, prepared);
  const receipt: ReleaseReceipt = journal.read<ReleaseReceipt>('receipt.json') || {
    schema: 1, runId: plan.runId, profile: plan.profile, commit: prepared.commit, completedAt: new Date().toISOString(), plan, prepared, server, baselines,
    ota: [...plan.previousOta.filter(old => !ota?.receipts.some(o => o.platform === old.platform && o.runtimeVersion === old.runtimeVersion)), ...(ota?.receipts || [])],
  };
  journal.put('receipt.json', receipt);
  const tag = `release/${plan.profile}/${plan.runId}`;
  const existingTag = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  if (existingTag) assert(existingTag.split(/\s/)[0] === prepared.commit, 'Completion tag conflicts.');
  else { git(['tag', tag, prepared.commit]); git(['push', 'origin', `refs/tags/${tag}`]); }
  const temp = mkdtempSync(resolve(tmpdir(), 'little-say-complete-'));
  const notes = resolve(temp, 'notes.md');
  const deployment = plan.server || plan.ota.length ? 'The preceding workflow deployment upgraded the self-hosted testing Compose server and passed readiness checks. This receipt does not attest the deployed image digest.' : 'This native-only cut did not run a server deployment.';
  const message = `Released ${plan.profile} from \`${prepared.commit}\`.\n\n${releaseSummary(plan, { server, baselines, ota: ota?.receipts || [], skipped: ota?.skipped || [] })}\n\n${deployment} Store processing/public rollout and device installation or OTA uptake have not been verified.\n`;
  writeFileSync(notes, message);
  let release = releases().find(r => r.tag_name === tag);
  if (!release) { gh(['release', 'create', tag, '--repo', process.env.GITHUB_REPOSITORY!, '--draft', '--verify-tag', '--title', `Little Say ${plan.profile} ${plan.runId}`, '--notes-file', notes]); release = releases().find(r => r.tag_name === tag); }
  const existing = readAsset(release, 'receipt.json');
  if (existing) assert(hash(existing) === hash(receipt), 'Completion manifest conflicts.');
  else { const file = resolve(temp, 'receipt.json'); writeJson(file, receipt); gh(['release', 'upload', tag, file, '--repo', process.env.GITHUB_REPOSITORY!]); }
  assert(hash(readAsset(releases().find(r => r.tag_name === tag), 'receipt.json')) === hash(receipt), 'Completion receipt readback failed.');
  gh(['release', 'edit', tag, '--repo', process.env.GITHUB_REPOSITORY!, '--draft=false', '--latest=false']);
  assert(completedReceipts().some(r => r.runId === plan.runId), 'Completed release is not readable.');
  gh(['release', 'delete', journal.tag, '--repo', process.env.GITHUB_REPOSITORY!, '--yes']);
  summary(`${message}\nRelease: https://github.com/${process.env.GITHUB_REPOSITORY}/releases/tag/${tag}`);
}

/** Run a workflow release stage or read-only plan; server promotion precedes deployment, and retries retain recorded operations. */
export async function unifiedRelease(command = process.argv[2] || 'prepare'): Promise<void> {
  assert(process.env.GITHUB_REPOSITORY && /^[\w.-]+\/[\w.-]+$/.test(process.env.GITHUB_REPOSITORY), 'Set GITHUB_REPOSITORY.');
  const dry = command === 'plan';
  assert(dry || process.env.RELEASE_DRY_RUN !== 'true', 'RELEASE_DRY_RUN was removed. Use npm run release:plan to preview without publication.');
  if (!dry) assert(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REF === `refs/heads/${process.env.DEFAULT_BRANCH}`, 'Cut releases explicitly from the default-branch workflow.');
  const runId = process.env.GITHUB_RUN_ID || '1'; const journal = new Journal(runId);
  journal.assertActive();
  const done = completedReceipts().find(r => r.runId === runId);
  if (done && !dry) {
    const tag = `release/${done.profile}/${runId}`;
    assert(done.profile === (process.env.RELEASE_PROFILE || 'internal') && git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]).split(/\s/)[0] === done.commit, 'Completed release identity/tag conflicts.');
    const retained = journal.read<ReleaseReceipt>('receipt.json');
    assert(!retained || hash(retained) === hash(done), 'Completed receipt differs from its durable candidate.');
    if (journal.release()) gh(['release', 'delete', journal.tag, '--repo', process.env.GITHUB_REPOSITORY!, '--yes']);
    summary(`Release ${runId} is already complete; no operations repeated.`); output('active', false); return;
  }
  if (command === 'prepare' || command === 'plan') {
    if (!dry) reconcileCandidates(runId);
    const saved = dry ? undefined : journal.read<ReleasePlan>('plan.json');
    const plan = saved || await createPlan(runId);
    assert(plan.schema === 1 && plan.runId === runId, 'Journal plan identity differs from this run.');
    // Historical force-all and native patch allocations belong to the saved plan, not today's planner.
    assert(['auto', 'force_all'].includes(plan.mode) && plan.profile === (process.env.RELEASE_PROFILE || 'internal') && plan.bump === (process.env.RELEASE_BUMP || 'patch'), 'Run inputs differ from the original immutable plan.');
    if (!saved) await preflight(plan, dry);
    else summary(`Resuming recorded release ${runId}.\n\n${releaseSummary(plan)}`);
    if (dry || !hasWork(plan)) { summary(dry ? 'Dry run complete. No release operations performed.' : 'No publishable changes. No versions or tags allocated.'); output('active', false); return; }
    journal.create(plan.source); journal.put('plan.json', plan);
    let prepared: PreparedRelease;
    try { prepared = prepareCandidate(plan, journal); }
    catch (error) {
      if (error instanceof StaleCandidateError) {
        try { retireCandidate(runId, true); }
        catch (cleanup) { summary(`Retirement is incomplete: ${cleanup instanceof Error ? cleanup.message : 'unknown outcome'}. The next fresh cut must reconcile the protected journal before planning.`); }
      }
      throw error;
    }
    git(['switch', '--detach', prepared.commit]); guard(plan, prepared);
    validateReleaseSource();
    output('active', true); output('commit', prepared.commit); output('server', plan.server); output('native', plan.native); output('ota', plan.ota.length > 0); output('profile', plan.profile); return;
  }
  const plan = journal.read<ReleasePlan>('plan.json'); const prepared = journal.read<PreparedRelease>('prepared.json');
  assert(plan && prepared, 'Release has not been prepared. Resume its prepare job first.');
  assert(plan.schema === 1 && plan.runId === runId, 'Journal plan identity differs from this run.'); guard(plan, prepared);
  if (command === 'server') { assert(plan.server, 'Server publication is not planned.'); publishImage(plan, prepared.commit, journal); }
  else if (command === 'promote-server') {
    assert(plan.server, 'Server promotion is not planned.');
    const published = journal.operation<ServerReceipt>('server'); const server = published?.result;
    assert(published?.status === 'complete' && server, 'Missing verified server publication before promotion.');
    assert(server.commit === prepared.commit && server.version === plan.serverVersion && server.input === plan.inputs.server && server.image === `ghcr.io/${process.env.GITHUB_REPOSITORY!.toLowerCase()}`, 'Server publication differs from the prepared release.');
    promoteImage(server);
  }
  else if (command === 'native' || command === 'submit') {
    const platform = process.env.RELEASE_PLATFORM as Platform; assert(plan.native.includes(platform), 'Native platform is not planned.');
    if (command === 'native') await cloudBuild(plan, prepared.commit, platform, journal);
    else { const b = journal.operation<NativeBuildBaseline>(`build-${platform}`)?.result; assert(b, 'Native build is not complete.'); await submitBuild(plan, b, journal); }
  } else if (command === 'ota') journal.put('ota.json', await publishOta(plan, prepared.commit, nativeResults(plan, journal), journal));
  else if (command === 'finalize') await finalize(plan, prepared, journal);
  else throw new Error('Usage: release:cut -- plan|prepare|server|promote-server|native|submit|ota|finalize');
}

if (isMain(import.meta.url)) unifiedRelease().catch(error => {
  summary(`Release stage **${process.argv[2] || 'prepare'}** stopped: ${error instanceof Error ? error.message : 'unknown failure'}\n\nRecovery evidence is retained in candidate/<run-id> or abandoned/<run-id> draft journals. During preparation, use the blocking journal named above; it can belong to an earlier run. Never rerun an abandoned run. Retry only recoverable review/provider states after reconciliation; see docs/releases.md. Completed baselines have not advanced unless the completion release is published.`);
  fail(error);
});
