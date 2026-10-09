/** @file Prepares or resumes a protected version-only release PR and validates its exact merged source. */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { assert, cleanCommit, git, npm, writeJson } from './common';
import type { PreparedRelease, ReleasePlan } from './contract';
import { gh, Journal } from './journal';
import { releaseFiles, StaleCandidateError, validateCandidate, writeReleaseDocuments } from './metadata';

/** Recheck the live base without replacing the immutable plan or bypassing normal merge protection. */
export function assertCandidateBase(plan: ReleasePlan): void {
  const current = git(['ls-remote', 'origin', `refs/heads/${process.env.DEFAULT_BRANCH}`]).split(/\s/)[0];
  assert(/^[a-f0-9]{40}$/.test(current), 'Cannot verify the default branch.');
  if (current !== plan.source) throw new StaleCandidateError(`Default branch moved from ${plan.source} to ${current}.`);
}

/** Validate product source and PostgreSQL behavior before recording the normal required check on a bot-created PR. */
export function validateReleaseSource(): void { npm(['run', 'check']); npm(['run', 'test:integration']); }

/** Prepare the run's candidate once; retries preserve versions and require the same tree after normal squash merge. */
export function prepareCandidate(plan: ReleasePlan, journal: Journal): PreparedRelease {
  const base = process.env.DEFAULT_BRANCH!; const repo = process.env.GITHUB_REPOSITORY!;
  const previous = journal.read<PreparedRelease>('prepared.json');
  if (previous) return previous;
  if (!plan.server && !plan.native.length) {
    assert(cleanCommit() === plan.source, 'OTA source moved.'); validateReleaseSource();
    const result = { commit: plan.source, candidate: plan.source, tree: git(['rev-parse', 'HEAD^{tree}']) };
    journal.put('prepared.json', result); return result;
  }
  const branch = `release/unified-run-${plan.runId}`;
  const prs = JSON.parse(gh(['pr', 'list', '--repo', repo, '--head', branch, '--state', 'all', '--json', 'url,state,baseRefName,headRefOid,mergeCommit']));
  assert(prs.length <= 1 && prs[0]?.state !== 'CLOSED', 'Release PR is ambiguous or abandoned. Do not replace it silently.');
  let pr = prs[0];
  if (pr) assert(pr.baseRefName === base, 'Release PR base differs.');
  const saved = journal.read<{ candidate: string; tree: string }>('candidate.json');
  const remote = git(['ls-remote', 'origin', `refs/heads/${branch}`]);
  if (saved) {
    git(['fetch', 'origin', saved.candidate]); git(['switch', '--detach', saved.candidate]);
  } else if (remote) {
    git(['fetch', 'origin', `refs/heads/${branch}`]); git(['switch', '--detach', 'FETCH_HEAD']);
  } else {
    assert(!pr && cleanCommit() === plan.source, 'Candidate source moved.');
    assertCandidateBase(plan);
    git(['config', 'user.name', 'github-actions[bot]']);
    git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    git(['switch', '-c', branch]); writeReleaseDocuments(plan);
    git(['add', '--', ...releaseFiles]); git(['commit', '-m', `Prepare Little Say release ${plan.runId}`]);
  }
  const candidate = cleanCommit(); validateCandidate(plan, candidate);
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  assert(!saved || saved.candidate === candidate && saved.tree === tree, 'Recorded candidate changed.');
  assert(!pr || pr.headRefOid === candidate, 'Release PR head changed.');
  if (pr?.state !== 'MERGED') {
    validateReleaseSource(); assert(cleanCommit() === candidate, 'Checks changed candidate source.');
    if (!remote) git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
    else assert(remote.split(/\s/)[0] === candidate, 'Remote candidate branch moved.');
    // Persist only reachable commits. A lost push response is recovered from the run's branch.
    journal.put('candidate.json', { candidate, tree });
    const temp = mkdtempSync(resolve(tmpdir(), 'little-say-cut-'));
    const check = resolve(temp, 'check.json');
    writeJson(check, { name: 'check', head_sha: candidate, status: 'completed', conclusion: 'success', output: { title: 'Release candidate validated', summary: 'npm run check and PostgreSQL integration tests passed on this exact candidate.' } });
    gh(['api', `repos/${repo}/check-runs`, '--method', 'POST', '--input', check]);
    if (!pr) {
      const body = resolve(temp, 'body.md');
      writeFileSync(body, `Prepare the allocated server/native versions for release ${plan.runId} (${plan.mode}, ${plan.profile}).\n\nOnly version metadata changes. Repository checks and PostgreSQL integration tests passed on this candidate. The original Cut release run resumes publication after normal merge; rerun its failed jobs if review is required.\n`);
      gh(['pr', 'create', '--repo', repo, '--base', base, '--head', branch, '--title', `Prepare Little Say release ${plan.runId}`, '--body-file', body]);
    }
    pr = JSON.parse(gh(['pr', 'view', branch, '--repo', repo, '--json', 'url,state,headRefOid,mergeCommit']));
    assert(pr.headRefOid === candidate, 'Release PR head changed before merge.');
    // Validation can take minutes; a check made only before preparation misses intervening merges.
    if (pr.state !== 'MERGED') assertCandidateBase(plan);
    console.log(`Release PR: ${pr.url}. If reviews are required, merge normally and rerun failed jobs in this run.`);
    if (pr.state !== 'MERGED') gh(['pr', 'merge', pr.url, '--squash', '--match-head-commit', candidate]);
    pr = JSON.parse(gh(['pr', 'view', branch, '--repo', repo, '--json', 'url,state,headRefOid,mergeCommit']));
  }
  assert(pr.state === 'MERGED' && pr.mergeCommit?.oid, 'Release awaits normal merge. Rerun this same workflow after review/merge.');
  journal.put('candidate.json', { candidate, tree });
  const commit = pr.mergeCommit.oid;
  git(['fetch', 'origin', base]); git(['fetch', 'origin', commit]);
  git(['merge-base', '--is-ancestor', commit, `origin/${base}`]);
  // Fetch failures remain retryable. A verified different merge tree is terminal, including the last-check race.
  const mergedTree = git(['rev-parse', `${commit}^{tree}`]);
  if (mergedTree !== tree) throw new StaleCandidateError('Functional source moved during merge.');
  validateCandidate(plan, commit);
  const result = { commit, candidate, tree }; journal.put('prepared.json', result); return result;
}
