/** @file Retires only proven unpublished terminal candidates, retaining durable tombstones and every original asset. */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { assert, git, writeJson } from './common';
import { assertCommit, type ReleasePlan } from './contract';
import { hash } from './inputs';
import { gh, readAsset, releases, verifyRetirement, type Retirement } from './journal';
import { validateCandidate } from './metadata';

function api(path: string): any { return JSON.parse(gh(['api', `repos/${process.env.GITHUB_REPOSITORY}/${path}`])); }
function pages(path: string): any[] { return JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${process.env.GITHUB_REPOSITORY}/${path}`])); }
function upload(release: any, name: string, value: unknown): void {
  const existing = readAsset(release, name);
  if (existing !== undefined) { assert(hash(existing) === hash(value), 'Retirement record conflicts.'); return; }
  const file = resolve(mkdtempSync(resolve(tmpdir(), 'little-say-retire-')), name); writeJson(file, value);
  gh(['release', 'upload', release.tag_name, file, '--repo', process.env.GITHUB_REPOSITORY!]);
  assert(hash(readAsset(api(`releases/${release.id}`), name)) === hash(value), 'Retirement record readback failed.');
}

function unpublished(release: any, plan: Pick<ReleasePlan, 'runId' | 'source'>, currentFailure: boolean): any {
  assert(release.author?.login === 'github-actions[bot]', 'Candidate journal ownership is unverified.');
  assert(release.draft && release.assets.every((a: any) => ['plan.json', 'candidate.json', 'retirement.json', 'retirement-complete.json'].includes(a.name)), 'Publication or unknown journal state requires reconciliation; candidate remains blocking.');
  const run = api(`actions/runs/${plan.runId}`);
  assert(String(run.id) === plan.runId && run.head_sha === plan.source && run.head_branch === process.env.DEFAULT_BRANCH && run.event === 'workflow_dispatch' && run.path === '.github/workflows/cut-release.yml', 'Candidate workflow/source ownership is unverified.');
  assert(currentFailure ? plan.runId === process.env.GITHUB_RUN_ID && run.status === 'in_progress' : run.status === 'completed' && ['failure', 'cancelled', 'timed_out'].includes(run.conclusion), 'Candidate run is active or not a terminal failed run.');
  // All attempts matter: absence of a success receipt cannot prove that a provider request was never sent.
  const result = pages(`actions/runs/${plan.runId}/jobs?filter=all&per_page=100`);
  const jobs = result.flatMap(p => p.jobs);
  assert(result.length > 0 && jobs.length === result[0].total_count && jobs.some(j => j.name === 'prepare'), 'Incomplete workflow job evidence.');
  assert(jobs.every(j => j.name === 'prepare' || j.conclusion === 'skipped' || currentFailure && j.status === 'queued' && !j.started_at), 'A non-prepare job may have run; reconcile provider outcomes before retirement.');
  assert(!releases().some(r => /^release\/(internal|production)\//.test(r.tag_name) && r.tag_name.endsWith(`/${plan.runId}`)), 'Completion publication exists; preserve candidate recovery.');
  return run;
}

function versionPr(plan: Pick<ReleasePlan, 'runId' | 'source'>): any | undefined {
  const branch = `release/unified-run-${plan.runId}`;
  const matches = JSON.parse(gh(['pr', 'list', '--repo', process.env.GITHUB_REPOSITORY!, '--head', branch, '--state', 'all', '--json', 'number']));
  assert(matches.length <= 1, 'Ambiguous version PR ownership.');
  if (!matches.length) return undefined;
  const pr = api(`pulls/${matches[0].number}`);
  assert(pr.head.repo?.full_name === process.env.GITHUB_REPOSITORY && pr.base.repo?.full_name === process.env.GITHUB_REPOSITORY && pr.head.ref === branch && pr.base.ref === process.env.DEFAULT_BRANCH && pr.user?.login === 'github-actions[bot]', 'Version PR ownership or retirement scope differs.');
  assert(!pr.auto_merge, 'Version PR has an automatic/queued merge; preserve it for reconciliation.');
  return pr;
}

/** Inspect one failed run under workflow-wide serialization; never publish, revert metadata, or erase assets. */
export function retireCandidate(runId: string, currentFailure = false): boolean {
  assert(/^[1-9]\d*$/.test(runId), 'Invalid retirement run ID.');
  const matches = releases().filter(r => r.tag_name === `candidate/${runId}` || r.tag_name === `abandoned/${runId}`);
  assert(matches.length <= 1, 'Duplicate candidate/abandoned identity requires reconciliation.');
  let release = matches[0];
  if (!release) return false;
  const plan = readAsset<ReleasePlan>(release, 'plan.json');
  assert(!plan || plan.schema === 1 && plan.runId === runId, 'Retirement plan identity conflicts.');
  const identity = plan || { runId, source: release.target_commitish };
  assertCommit(identity.source);
  const run = unpublished(release, identity, currentFailure);
  let record = readAsset<Retirement>(release, 'retirement.json');
  if (release.tag_name === `abandoned/${runId}`) {
    const verified = verifyRetirement(release, false);
    upload(release, 'retirement-complete.json', { retirementHash: hash(verified) });
    verifyRetirement(api(`releases/${release.id}`)); return true;
  }
  const candidate = readAsset<{ candidate: string; tree: string }>(release, 'candidate.json');
  const pr = versionPr(identity);
  if (!plan) {
    assert(!pr && release.assets.every((a: any) => ['retirement.json', 'retirement-complete.json'].includes(a.name)) && !git(['ls-remote', 'origin', `refs/heads/release/unified-run-${runId}`]), 'Missing plan with candidate work requires reconciliation.');
  }
  if (pr) {
    assert(plan && candidate && pr.head.sha === candidate.candidate, 'Version PR candidate identity differs or is missing.');
    assertCommit(candidate.candidate); assertCommit(candidate.tree);
    git(['fetch', 'origin', candidate.candidate]); validateCandidate(plan, candidate.candidate);
    assert(git(['rev-parse', `${candidate.candidate}^{tree}`]) === candidate.tree, 'Recorded candidate tree differs.');
  }
  let reason: string | undefined = !plan ? 'Run stopped before its immutable plan was saved.' : undefined;
  if (pr?.merged) {
    assertCommit(pr.merge_commit_sha); git(['fetch', 'origin', pr.merge_commit_sha]);
    if (git(['rev-parse', `${pr.merge_commit_sha}^{tree}`]) !== candidate!.tree) reason = `Merged source ${pr.merge_commit_sha} differs from validated candidate ${candidate!.candidate}.`;
  } else {
    const base = git(['ls-remote', 'origin', `refs/heads/${process.env.DEFAULT_BRANCH}`]).split(/\s/)[0]; assertCommit(base);
    if (base !== identity.source) reason = `Default branch moved from ${identity.source} to ${base}.`;
    else if (pr?.state === 'closed') reason = 'Owned version PR was closed without merging.';
    else if (!pr && run.conclusion === 'cancelled') reason = 'Run cancelled before preparation or publication.';
  }
  // Review waits, queued merges and transport/check failures remain retryable, not abandoned by age.
  if (!reason && !record) return false;
  record ||= { schema: 1, runId, releaseId: release.id, source: identity.source, reason: reason!, assets: release.assets.map((a: any) => ({ id: a.id, name: a.name, digest: a.digest, hash: hash(readAsset(release, a.name)) })) };
  assert(record.runId === runId && record.source === identity.source && record.releaseId === release.id, 'Retirement intent conflicts.');
  assert(record.assets.every(a => /^sha256:[a-f0-9]{64}$/.test(a.digest)), 'Original asset byte digests are unavailable; preserve the candidate for reconciliation.');
  // Persist the tombstone before closing the PR or moving the journal; retries can never recreate this run.
  upload(release, 'retirement.json', record);
  if (pr && !pr.merged && pr.state === 'open') {
    const fresh = versionPr(identity); assert(fresh?.head.sha === candidate!.candidate && !fresh.merged && fresh.state === 'open', 'Version PR changed during retirement.');
    gh(['api', `repos/${process.env.GITHUB_REPOSITORY}/pulls/${pr.number}`, '--method', 'PATCH', '-f', 'state=closed']);
    const closed = versionPr(identity); assert(closed?.head.sha === candidate!.candidate && !closed.merged && closed.state === 'closed', 'Version PR closure is uncertain.');
  }
  unpublished(api(`releases/${release.id}`), identity, currentFailure);
  gh(['api', `repos/${process.env.GITHUB_REPOSITORY}/releases/${release.id}`, '--method', 'PATCH', '-f', `tag_name=abandoned/${runId}`]);
  release = api(`releases/${release.id}`); verifyRetirement(release, false);
  upload(release, 'retirement-complete.json', { retirementHash: hash(record) });
  verifyRetirement(api(`releases/${release.id}`));
  assert(!releases().some(r => r.tag_name === `candidate/${runId}`), 'Candidate retirement is still blocking.');
  console.log(`Retired unpublished candidate ${runId}: ${record.reason} Journal and assets retained under abandoned/${runId}.`);
  return true;
}

/** Reconcile interrupted prior runs before planning; workflow concurrency prevents another cut from writing concurrently. */
export function reconcileCandidates(currentRunId: string): void {
  for (const release of releases().filter(r => /^(candidate|abandoned)\/\d+$/.test(r.tag_name))) {
    const runId = release.tag_name.split('/')[1];
    if (runId === currentRunId) continue;
    if (release.tag_name.startsWith('abandoned/') && readAsset(release, 'retirement-complete.json')) { verifyRetirement(release); continue; }
    assert(retireCandidate(runId), `Release ${runId} is retryable or unresolved. Resume/reconcile it before another cut.`);
  }
}
