/** @file Completes only terminal internal cuts whose original workflow published and deployed everything, using audited provider readbacks without rebuilding or republishing. */
import { resolve } from 'node:path';
import { assert, cleanCommit, fail, git, isMain, readJson, root, writeJson } from './common';
import { artifactHash, verifyBuildIdentity } from './cloud';
import { publishCompletion } from './completion';
import { assertCommit, validateCloudBaseline, type NativeBuildBaseline, type PreparedRelease, type ReleasePlan, type ServerReceipt } from './contract';
import { buildWithSubmissions, eas, expoEnvironment, updateGroups } from './expo';
import { verifyImage } from './image';
import { hash, sourceInputs } from './inputs';
import { completedReceipts, gh, Journal, readAsset, releases } from './journal';
import { releaseConfig } from './native-contract';
import { type OtaResults, verifyPublishedOta } from './ota';
import { readOperationHistory } from './reconciliation';

function api(path: string): any { return JSON.parse(gh(['api', `repos/${process.env.GITHUB_REPOSITORY}/${path}`])); }
function pages(path: string): any[] { return JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${process.env.GITHUB_REPOSITORY}/${path}`])); }

/** Audit the immutable journal and original job results; fail closed on active cuts, missing successful deployment, or unsupported publication scope. */
export function inspectCompletionCandidate(runId: string) {
  assert(/^[1-9]\d*$/.test(runId) && runId !== process.env.GITHUB_RUN_ID, 'Provide the original release run ID.');
  const cuts = pages('actions/workflows/cut-release.yml/runs?per_page=100');
  assert(cuts.length && cuts.flatMap(p => p.workflow_runs).length === cuts[0].total_count && cuts.flatMap(p => p.workflow_runs).every(r => r.status === 'completed'), 'A release cut is active or its history is incomplete.');
  const all = releases();
  assert(!all.some(r => r.tag_name === `abandoned/${runId}`), 'Never complete an abandoned release.');
  assert(!all.some(r => r.tag_name.startsWith('candidate/') && r.tag_name !== `candidate/${runId}`), 'Another candidate requires reconciliation.');
  const candidate = all.find(r => r.tag_name === `candidate/${runId}`);
  assert(candidate?.draft && candidate.author?.login === 'github-actions[bot]', 'Expected the original bot-owned candidate draft.');
  const allowed = /^(plan|candidate|prepared|ota|receipt|completion-recovery)\.json$|^op\.(server|build-android|build-ios|ota-(android|ios)-\d+\.\d+\.\d+)\.\d{6}\.json$/;
  assert(new Set(candidate.assets.map((a: any) => a.name)).size === candidate.assets.length && candidate.assets.every((a: any) => allowed.test(a.name)), 'Unknown or duplicate journal evidence.');
  const assets = candidate.assets.filter((a: any) => !['receipt.json', 'completion-recovery.json'].includes(a.name)).map((a: any) => {
    assert(/^sha256:[a-f0-9]{64}$/.test(a.digest), 'Missing original asset digest.');
    return { id: a.id, name: a.name, digest: a.digest, hash: hash(readAsset(candidate, a.name)) };
  }).sort((a: any, b: any) => a.name.localeCompare(b.name));
  const plan = readAsset<ReleasePlan>(candidate, 'plan.json')!;
  const prepared = readAsset<PreparedRelease>(candidate, 'prepared.json')!;
  const metadata = readAsset<{ candidate: string; tree: string }>(candidate, 'candidate.json');
  assert(plan?.schema === 1 && plan.runId === runId && plan.profile === 'internal' && plan.server && !plan.submissions.length && !plan.baselines.length && !plan.previousOta.length
    && hash([...plan.native].sort()) === hash(['android', 'ios']) && hash([...plan.ota].sort()) === hash(['android', 'ios']), 'Recovery supports only a complete internal server plus both new native/OTA targets.');
  const operationKeys = ['server', 'build-android', 'build-ios', ...plan.ota.map(p => `ota-${p}-${plan.nativeRelease.version}`)];
  assert(candidate.assets.every((a: any) => !a.name.startsWith('op.') || operationKeys.some(key => a.name.startsWith(`op.${key}.`))), 'Unexpected OTA runtime operation evidence.');
  assert(prepared && metadata && prepared.candidate === metadata.candidate && prepared.tree === metadata.tree, 'Prepared metadata differs.');
  for (const value of [plan.source, prepared.commit, prepared.candidate, prepared.tree]) assertCommit(value);
  assert(git(['rev-parse', `${prepared.commit}^{tree}`]) === prepared.tree, 'Prepared source tree differs.');
  git(['merge-base', '--is-ancestor', plan.source, prepared.commit]);
  git(['merge-base', '--is-ancestor', prepared.commit, `origin/${process.env.DEFAULT_BRANCH}`]);
  for (const done of completedReceipts()) {
    assert(done.runId !== runId, 'This release already has a published completion receipt.');
    git(['merge-base', '--is-ancestor', done.commit, prepared.commit]);
  }
  const run = api(`actions/runs/${runId}`);
  assert(String(run.id) === runId && run.head_sha === plan.source && run.head_branch === process.env.DEFAULT_BRANCH && run.event === 'workflow_dispatch' && run.path === '.github/workflows/cut-release.yml'
    && run.status === 'completed' && run.conclusion === 'failure', 'Original cut ownership/state differs.');
  const jobPages = pages(`actions/runs/${runId}/jobs?filter=latest&per_page=100`);
  const jobs = jobPages.flatMap(p => p.jobs);
  const required = ['prepare', 'server', 'promote-server', 'deploy / deploy', 'native (android)', 'native (ios)', 'ota'];
  assert(jobPages.length && jobs.length === jobPages[0].total_count && jobs.length === required.length + 2 && new Set(jobs.map(j => j.name)).size === jobs.length, 'Incomplete or unexpected workflow job evidence.');
  for (const name of required) assert(jobs.some(j => j.name === name && j.status === 'completed' && j.conclusion === 'success'), `Missing successful ${name} proof.`);
  assert(jobs.some(j => j.name === 'finalize' && j.status === 'completed' && j.conclusion === 'failure') && jobs.some(j => j.name === 'submit' && j.status === 'completed' && j.conclusion === 'skipped'), 'Finalization/submission state differs.');
  for (const target of ['server', 'android', 'ios'] as const) assert(sourceInputs(prepared.commit, target) === (target === 'server' ? plan.inputs.server : plan.inputs.bundle[target]), `Prepared ${target} inputs differ.`);
  assert(hash(JSON.parse(git(['show', `${prepared.commit}:release-policy.json`]))) === hash(readJson(resolve(root, 'release-policy.json'))), 'Recovery runtime policy differs from the prepared source.');
  const proof = { schema: 1, kind: 'verified-publication-completion', runId, releaseId: candidate.id, planHash: hash(plan), preparedHash: hash(prepared), assets,
    run: { id: run.id, attempt: run.run_attempt, source: run.head_sha }, jobs: jobs.map(j => ({ id: j.id, name: j.name, conclusion: j.conclusion })).sort((a, b) => a.name.localeCompare(b.name)) };
  return { candidate, plan, prepared, proof };
}

/** Read back every completed build, image and OTA asset before publishing the original cut's completion receipt; never start any provider or deployment operation. */
export async function recoverCompletion(runId: string, apply: boolean): Promise<void> {
  assert(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REF === `refs/heads/${process.env.DEFAULT_BRANCH}`
    && process.env.GITHUB_WORKFLOW_REF === `${process.env.GITHUB_REPOSITORY}/.github/workflows/recover-release.yml@refs/heads/${process.env.DEFAULT_BRANCH}`
    && cleanCommit() === process.env.GITHUB_SHA, 'Use the protected default-branch completion recovery workflow.');
  git(['fetch', 'origin', process.env.DEFAULT_BRANCH!, '--tags']);
  const { candidate, plan, prepared, proof } = inspectCompletionCandidate(runId);
  const journal = new Journal(runId);
  const identity = releaseConfig();
  for (const key of ['expoProjectId', 'expoOwner', 'serverUrl'] as const) assert(identity[key] === plan.nativeRelease[key], 'Recovery project identity differs.');
  assert((await expoEnvironment(plan.profile)).hash === plan.inputs.environmentHash, 'Recovery environment differs.');
  const serverOp = readOperationHistory<ServerReceipt>(candidate, 'server');
  const server = serverOp.result!;
  assert(serverOp.status === 'complete' && hash(serverOp.ids) === hash([prepared.commit]) && server?.commit === prepared.commit && server.version === plan.serverVersion
    && server.image === `ghcr.io/${process.env.GITHUB_REPOSITORY!.toLowerCase()}` && server.input === plan.inputs.server, 'Server publication proof differs.');
  assert(api(`git/ref/tags/v${server.version}`).object?.sha === prepared.commit && verifyImage(server.image, server.version, server.commit) === server.digest, 'Server image/tag readback differs.');
  const baselines: NativeBuildBaseline[] = [];
  for (const platform of plan.native) {
    const operation = readOperationHistory<NativeBuildBaseline>(candidate, `build-${platform}`);
    const baseline = operation.result!;
    assert(operation.status === 'complete' && baseline, 'Missing completed native publication.');
    validateCloudBaseline(baseline);
    assert(baseline.commit === prepared.commit && baseline.platform === platform && baseline.profile === plan.profile && hash(baseline.release) === hash(plan.nativeRelease)
      && baseline.environmentHash === plan.inputs.environmentHash && baseline.compatibility === plan.inputs.native[platform] && operation.ids.at(-1) === baseline.buildId, 'Native baseline proof differs.');
    const matching: any[] = [];
    for (let offset = 0; ; offset += 50) {
      const page = JSON.parse(eas(['build:list', '--platform', platform, '--build-profile', plan.profile, '--git-commit-hash', prepared.commit, '--offset', String(offset), '--limit', '50', '--json', '--non-interactive']));
      assert(Array.isArray(page), 'Unexpected EAS build list.');
      matching.push(...page.filter((b: any) => b.message === `little-say:${runId}:build:${platform}`));
      if (page.length < 50) break;
    }
    assert(hash(matching.map(b => b.id).sort()) === hash([...operation.ids].sort()), 'Unrecorded or missing native provider operations.');
    for (const id of operation.ids) {
      const build = await buildWithSubmissions(id); verifyBuildIdentity(build, plan, prepared.commit, platform);
      assert(Array.isArray(build.submissions) && build.submissions.length === 0, 'Unexpected internal submission evidence.');
      if (id !== baseline.buildId) { assert(['ERRORED', 'CANCELED'].includes(build.status), 'Earlier native operation is not a terminal failure.'); continue; }
      assert(build.status === 'FINISHED' && build.fingerprint?.hash === baseline.fingerprint, 'Successful build fingerprint/status differs.');
      assert(await artifactHash(build.artifacts.applicationArchiveUrl || build.artifacts.buildUrl) === baseline.artifactSha256, 'Native artifact bytes differ.');
    }
    baselines.push(baseline);
  }
  const ota = readAsset<OtaResults>(candidate, 'ota.json')!;
  for (const receipt of ota?.receipts || []) {
    const key = `${receipt.platform}-${receipt.runtimeVersion}`;
    readOperationHistory(candidate, `ota-${key}`);
    const matching: string[] = [];
    for (let offset = 0; ; offset += 50) {
      const page = await updateGroups(plan.channelBranch!.name, receipt.platform, receipt.runtimeVersion, offset);
      for (const group of page) if (group.some(u => u.message?.startsWith(`little-say:${runId}:ota:${key}:`))) {
        assert(group.length === 1, 'Unexpected multi-platform OTA group.'); matching.push(group[0].group);
      }
      if (page.length < 50) break;
    }
    assert(hash(matching) === hash([receipt.group]), 'Unrecorded or missing OTA provider operations.');
  }
  await verifyPublishedOta(plan, prepared.commit, baselines, journal, ota);
  assert(hash(inspectCompletionCandidate(runId).proof) === hash(proof), 'Original release evidence changed during verification.');
  writeJson(resolve(root, 'artifacts', `completion-recovery-${runId}.json`), proof);
  console.log(`All original publication and deployment evidence verified for ${runId}. Apply: ${apply}.`);
  if (!apply) return;
  journal.put('completion-recovery.json', proof);
  publishCompletion(plan, prepared, journal, baselines, ota, server);
}

if (isMain(import.meta.url)) recoverCompletion(process.env.RECOVERY_RUN_ID || '', process.env.RECOVERY_APPLY === 'true').catch(fail);
