/** @file Audits and explicitly abandons terminal internal image/build cuts without erasing artifacts or claiming release completion. */

import { resolve } from 'node:path';
import { assert, fail, isMain, parseArgs, readJson, root, writeJson } from './common';
import { assertCommit, validateCloudBaseline, type NativeBuildBaseline, type Operation, type PreparedRelease, type ReleasePlan, type ServerReceipt } from './contract';
import { verifyBuildIdentity } from './cloud';
import { buildWithSubmissions, eas } from './expo';
import { hash } from './inputs';
import { gh, readAsset, releases, verifyRetirement, type Retirement } from './journal';
import { uploadRetirementAsset } from './retirement';

interface Reconciliation {
  schema: 1; runId: string; releaseId: number; source: string; reason: string;
  assets: Retirement['assets'];
  run: { id: number; run_attempt: number; head_sha: string; conclusion: string };
  jobs: { id: number; name: string; conclusion: string; run_attempt: number }[];
  builds: { id: string; platform: string; status: string; fingerprint?: string }[];
  server: ServerReceipt;
}

const recoveryAssets = ['reconciliation.json', 'retirement.json', 'retirement-complete.json'];
function api(path: string): any { return JSON.parse(gh(['api', `repos/${process.env.GITHUB_REPOSITORY}${path ? `/${path}` : ''}`])); }
function pages(path: string): any[] { return JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${process.env.GITHUB_REPOSITORY}/${path}`])); }
function journal(runId: string): any {
  assert(/^[1-9]\d*$/.test(runId), 'Invalid reconciliation run ID.');
  const matches = releases().filter(r => [`candidate/${runId}`, `abandoned/${runId}`].includes(r.tag_name));
  assert(matches.length === 1, 'Expected exactly one retained candidate/abandoned journal.');
  const release = matches[0];
  assert(release.draft && release.author?.login === 'github-actions[bot]', 'Candidate ownership or draft state differs.');
  return release;
}
function idle(): void {
  const runs = pages('actions/workflows/cut-release.yml/runs?per_page=100');
  assert(runs.length > 0 && runs.flatMap(p => p.workflow_runs).length === runs[0].total_count, 'Incomplete release-run history.');
  assert(runs.flatMap(p => p.workflow_runs).every(r => r.status === 'completed'), 'A release cut is active. Wait for it before reconciliation.');
}
function originals(release: any): Retirement['assets'] {
  const assets = release.assets.filter((a: any) => !recoveryAssets.includes(a.name));
  assert(new Set(release.assets.map((a: any) => a.name)).size === release.assets.length, 'Duplicate journal assets.');
  assert(assets.every((a: any) => /^(plan|candidate|prepared)\.json$|^op\.(server|build-android|build-ios)\.\d{6}\.json$/.test(a.name)), 'Unsupported publication/unknown assets; reconcile manually.');
  return assets.map((a: any) => {
    assert(/^sha256:[a-f0-9]{64}$/.test(a.digest), 'Original asset byte digest is missing.');
    return { id: a.id, name: a.name, digest: a.digest, hash: hash(readAsset(release, a.name)) };
  }).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
}
/** Validate contiguous append-only operation history and return its terminal state, retaining all earlier provider IDs. */
export function readOperationHistory<T>(release: any, key: string): Operation<T> {
  const names = release.assets.map((a: any) => a.name as string).filter((n: string) => n.startsWith(`op.${key}.`)).sort();
  assert(names.length > 0, `Missing ${key} operation history.`);
  let previous: Operation<T> | undefined;
  for (const [index, name] of names.entries()) {
    const state = readAsset<Operation<T>>(release, name)!;
    assert(name === `op.${key}.${String(index + 1).padStart(6, '0')}.json` && state.schema === 1 && state.key === key && state.sequence === index + 1 && Array.isArray(state.ids), `Invalid ${key} operation history.`);
    assert(['intent', 'running', 'failed', 'complete'].includes(state.status) && state.ids.every(id => typeof id === 'string') && new Set(state.ids).size === state.ids.length, `Invalid ${key} operation state.`);
    assert(!previous || previous.ids.every((id, i) => state.ids[i] === id) && previous.status !== 'complete', `Rewritten ${key} operation history.`);
    previous = state;
  }
  assert(previous && ['complete', 'failed'].includes(previous.status) && previous.ids.length > 0, `Unresolved ${key} operation; no abandonment allowed.`);
  return previous;
}

/** Read all attempts and exact EAS IDs; support only internal image/build cuts with no deployment, OTA, or submission work. */
export async function inspectPartialRelease(runId: string, reason: string): Promise<Reconciliation> {
  assert(reason.trim().length >= 20, 'Provide a specific reason for abandoning the remaining release work.');
  idle();
  const release = journal(runId);
  const assets = originals(release);
  const plan = readAsset<ReleasePlan>(release, 'plan.json');
  const prepared = readAsset<PreparedRelease>(release, 'prepared.json');
  const candidate = readAsset<{ candidate: string; tree: string }>(release, 'candidate.json');
  assert(plan?.schema === 1 && plan.runId === runId && plan.profile === 'internal' && plan.server && plan.submissions.length === 0 && hash([...plan.native].sort()) === hash(['android', 'ios']), 'Only internal server plus Android/iOS cuts are supported.');
  assert(prepared && candidate && prepared.candidate === candidate.candidate && prepared.tree === candidate.tree, 'Prepared candidate identity differs.');
  for (const commit of [plan.source, prepared.commit, prepared.candidate, prepared.tree]) assertCommit(commit);
  const run = api(`actions/runs/${runId}`);
  const branch = api('').default_branch;
  assert(String(run.id) === runId && run.head_sha === plan.source && run.head_branch === branch && run.event === 'workflow_dispatch' && run.path === '.github/workflows/cut-release.yml', 'Candidate workflow/source ownership differs.');
  assert(run.status === 'completed' && ['failure', 'cancelled', 'timed_out'].includes(run.conclusion), 'Candidate run is not a terminal failed run.');
  assert(!releases().some(r => /^release\/(internal|production)\//.test(r.tag_name) && r.tag_name.endsWith(`/${runId}`)), 'Completion publication exists; do not abandon it.');
  const jobPages = pages(`actions/runs/${runId}/jobs?filter=all&per_page=100`);
  const jobs = jobPages.flatMap(p => p.jobs);
  assert(jobPages.length > 0 && jobs.length === jobPages[0].total_count && jobs.every(j => j.status === 'completed'), 'Incomplete/active workflow job evidence.');
  assert(jobs.every(j => ['prepare', 'server', 'native (android)', 'native (ios)'].includes(j.name) || j.conclusion === 'skipped'), 'Deployment, OTA, submission, or unknown jobs may have run; unsupported recovery.');
  for (const name of ['prepare', 'server']) assert(jobs.some(j => j.name === name && j.conclusion === 'success'), `Missing successful ${name} job proof.`);
  const serverOp = readOperationHistory<ServerReceipt>(release, 'server');
  const server = serverOp.result;
  assert(serverOp.status === 'complete' && server && serverOp.ids.length === 1 && serverOp.ids[0] === prepared.commit && server.commit === prepared.commit && server.version === plan.serverVersion && server.input === plan.inputs.server && server.image === `ghcr.io/${process.env.GITHUB_REPOSITORY!.toLowerCase()}` && /^sha256:[a-f0-9]{64}$/.test(server.digest), 'Server publication lacks a matching verified receipt.');
  const tag = api(`git/ref/tags/v${server.version}`);
  assert(tag.object?.type === 'commit' && tag.object.sha === prepared.commit, 'Server version tag differs from the receipt.');
  const builds: Reconciliation['builds'] = [];
  for (const platform of ['android', 'ios'] as const) {
    const op = readOperationHistory<NativeBuildBaseline>(release, `build-${platform}`);
    assert(jobs.some(j => j.name === `native (${platform})` && j.conclusion === (op.status === 'complete' ? 'success' : 'failure')), `Missing terminal ${platform} job proof.`);
    const matching: any[] = [];
    for (let offset = 0; ; offset += 50) {
      const page = JSON.parse(eas(['build:list', '--platform', platform, '--build-profile', plan.profile, '--git-commit-hash', prepared.commit, '--offset', String(offset), '--limit', '50', '--json', '--non-interactive']));
      assert(Array.isArray(page), 'Unexpected EAS build list.');
      matching.push(...page.filter(b => b.message === `little-say:${runId}:build:${platform}`));
      if (page.length < 50) break;
    }
    assert(hash(matching.map(b => b.id).sort()) === hash([...op.ids].sort()), `Unrecorded/missing ${platform} builds; reconcile their outcomes first.`);
    for (const id of op.ids) {
      const build = await buildWithSubmissions(id);
      verifyBuildIdentity(build, plan, prepared.commit, platform);
      assert(build.id === id && build.message === `little-say:${runId}:build:${platform}` && Array.isArray(build.submissions) && build.submissions.length === 0, 'Build identity/submission state differs.');
      const successful = id === op.ids.at(-1) && op.status === 'complete';
      assert(successful ? build.status === 'FINISHED' : ['ERRORED', 'CANCELED'].includes(build.status), `Build ${id} is active or its terminal outcome differs.`);
      if (successful) {
        const baseline = op.result!; validateCloudBaseline(baseline);
        assert(baseline.buildId === id && baseline.commit === prepared.commit && baseline.platform === platform && baseline.profile === plan.profile && hash(baseline.release) === hash(plan.nativeRelease) && baseline.environmentHash === plan.inputs.environmentHash && baseline.compatibility === plan.inputs.native[platform] && baseline.fingerprint === build.fingerprint?.hash, 'Completed native receipt differs from EAS/plan.');
      }
      builds.push({ id, platform, status: build.status, fingerprint: build.fingerprint?.hash });
    }
  }
  idle();
  assert(hash(originals(journal(runId))) === hash(assets), 'Journal changed during inspection.');
  return { schema: 1, runId, releaseId: release.id, source: plan.source, reason, assets,
    run: { id: run.id, run_attempt: run.run_attempt, head_sha: run.head_sha, conclusion: run.conclusion },
    jobs: jobs.map(({ id, name, conclusion, run_attempt }) => ({ id, name, conclusion, run_attempt })).sort((a, b) => a.id - b.id), builds, server };
}

/** Re-audit reviewed evidence, then preserve the same draft and all assets under abandoned; never publish or advance baselines. */
export async function abandonPartialRelease(evidence: Reconciliation): Promise<void> {
  assert(hash(await inspectPartialRelease(evidence.runId, evidence.reason)) === hash(evidence), 'Recovery evidence changed; inspect again before applying.');
  let release = journal(evidence.runId);
  const existing = readAsset<Retirement>(release, 'retirement.json');
  assert(!existing || existing.kind === 'reconciled-partial' && existing.evidenceHash === hash(evidence), 'Retirement intent conflicts with reviewed evidence.');
  uploadRetirementAsset(release, 'reconciliation.json', evidence);
  release = journal(evidence.runId);
  const proof = release.assets.find((a: any) => a.name === 'reconciliation.json');
  assert(proof && /^sha256:[a-f0-9]{64}$/.test(proof.digest), 'Reconciliation evidence byte digest is unavailable.');
  const record: Retirement = { schema: 1, kind: 'reconciled-partial', runId: evidence.runId, releaseId: evidence.releaseId, source: evidence.source, reason: evidence.reason, evidenceHash: hash(evidence),
    assets: [...evidence.assets, { id: proof.id, name: proof.name, digest: proof.digest, hash: hash(evidence) }] };
  idle();
  uploadRetirementAsset(release, 'retirement.json', record);
  idle();
  assert(hash(originals(journal(evidence.runId))) === hash(evidence.assets), 'Journal changed before archival.');
  if (release.tag_name.startsWith('candidate/')) gh(['api', `repos/${process.env.GITHUB_REPOSITORY}/releases/${release.id}`, '--method', 'PATCH', '-f', `tag_name=abandoned/${evidence.runId}`]);
  release = journal(evidence.runId); verifyRetirement(release, false);
  uploadRetirementAsset(release, 'retirement-complete.json', { retirementHash: hash(record) });
  verifyRetirement(journal(evidence.runId));
}

/** Preview to a local JSON file by default; --apply requires that exact reviewed evidence and repeats all remote checks. */
export async function reconcilePartialRelease(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args, ['run', 'reason', 'evidence', 'apply']);
  assert(process.env.GITHUB_REPOSITORY, 'Set GITHUB_REPOSITORY before reconciliation.');
  assert(options.run && options.reason && (!options.apply || options.apply === 'true'), 'Use --run ID --reason TEXT [--evidence FILE] [--apply].');
  const file = resolve(options.evidence || resolve(root, 'artifacts', `reconciliation-${options.run}.json`));
  if (options.apply) {
    const evidence = readJson<Reconciliation>(file);
    assert(evidence.runId === options.run && evidence.reason === options.reason, 'Reviewed run/reason differs.');
    await abandonPartialRelease(evidence);
    console.log(`Preserved partial release ${options.run} under abandoned/${options.run}. No completion baseline advanced. Never rerun this abandoned workflow; use a fresh cut.`);
  } else {
    writeJson(file, await inspectPartialRelease(options.run, options.reason));
    console.log(`Recovery evidence saved to ${file}. No remote changes. Review it before repeating with --apply; stop all release dispatches until recovery finishes.`);
  }
}

if (isMain(import.meta.url)) reconcilePartialRelease().catch(fail);
