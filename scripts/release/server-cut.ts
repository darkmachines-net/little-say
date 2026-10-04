/**
 * @file Prepares or resumes a run's version-only release PR and returns its merged commit for
 * automatic GHCR publication in the same GitHub workflow.
 */

import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { assert, cleanCommit, fail, git, isMain, npm, readJson, root, run } from './common';
import { prepare, serverFiles, validateCommit } from './version';

type ReleasePr = { url: string; state: string; baseRefName: string; headRefOid: string; mergeCommit: { oid: string } | null };

function publishCommit(pr: ReleasePr, base: string) {
  assert(pr.state === 'MERGED' && /^[a-f0-9]{40}$/.test(pr.mergeCommit?.oid || ''), 'Release PR is awaiting merge. Complete the normal review/merge process, then re-run failed jobs in this Cut server release run.');
  const commit = pr.mergeCommit!.oid;
  git(['fetch', 'origin', `refs/heads/${base}:refs/remotes/origin/${base}`]);
  git(['merge-base', '--is-ancestor', commit, `origin/${base}`]);
  const version = validateCommit(commit);
  appendFileSync(process.env.GITHUB_OUTPUT!, `commit=${commit}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Server ${version} is merged at ${commit}. The publish job in this run will build and verify its GHCR image.\n`);
}

/**
 * Prepare and validate a server release, respecting normal PR merge rules. Re-runs recover the
 * same run-scoped branch/PR, including an already merged release, without allocating another version.
 * Write the validated merge SHA to GITHUB_OUTPUT for the dependent publication job.
 */
export function cutServerRelease() {
  assert(process.env.GITHUB_ACTIONS === 'true', 'Cut server releases from the GitHub Actions workflow.');
  const base = process.env.DEFAULT_BRANCH!;
  assert(base && process.env.GITHUB_REF === `refs/heads/${base}`, 'Run this workflow on the default branch.');
  const repo = process.env.GITHUB_REPOSITORY!;
  const runId = process.env.GITHUB_RUN_ID!;
  assert(/^[1-9]\d*$/.test(runId || ''), 'Missing GitHub workflow run ID.');
  assert(process.env.GITHUB_OUTPUT, 'Missing workflow output file.');
  // GitHub preserves this ID across job re-runs, even when the default branch has advanced.
  const branch = `release/server-run-${runId}`;
  const commit = cleanCommit();
  const existing: ReleasePr[] = JSON.parse(run('gh', ['pr', 'list', '--repo', repo, '--head', branch, '--state', 'all', '--json', 'url,state,baseRefName,headRefOid,mergeCommit'], { capture: true }));
  assert(existing.length <= 1, 'Multiple PRs match this release run. Resolve them before retrying.');
  let pr = existing[0];
  if (pr) {
    assert(pr.baseRefName === base, 'The release PR targets a different branch.');
    assert(pr.state !== 'CLOSED', 'This release PR was closed without merging. Start a new Cut server release run.');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Release PR: ${pr.url}\n\n`);
    if (pr.state === 'MERGED') { publishCommit(pr, base); return; }
  }
  const open = JSON.parse(run('gh', ['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'headRefName,url'], { capture: true }));
  assert(!open.some((other: any) => other.headRefName.startsWith('release/server-') && other.headRefName !== branch), 'Another server release PR is already open. Finish or close it first.');
  const remote = git(['ls-remote', 'origin', `refs/heads/${branch}`]);
  if (remote) {
    const head = remote.split(/\s/)[0];
    assert(!pr || pr.headRefOid === head, 'Release PR source moved. Retry after reviewing the candidate.');
    git(['fetch', 'origin', `refs/heads/${branch}`]);
    assert(git(['rev-parse', 'FETCH_HEAD']) === head, 'Release branch moved while fetching. Retry after reviewing the candidate.');
    git(['switch', '--detach', head]);
  } else {
    assert(!pr, 'The release PR branch is missing. Restore it or close the PR before starting a new release.');
    assert(git(['ls-remote', 'origin', `refs/heads/${base}`]).split(/\s/)[0] === commit, 'Default branch moved. Run Cut server release again.');
    prepare('server', process.env.RELEASE_BUMP || 'patch');
    const version = readJson(resolve(root, 'release.json')).version;
    git(['switch', '-c', branch]);
    git(['config', 'user.name', 'github-actions[bot]']);
    git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    git(['add', '--', ...serverFiles]);
    git(['commit', '-m', `Release server ${version}`]);
  }
  const head = git(['rev-parse', 'HEAD']);
  const version = validateCommit(head);
  npm(['run', 'check']);
  assert(cleanCommit() === head, 'Checks changed release source.');
  if (!remote) git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  // GITHUB_TOKEN-created pushes do not start normal push/PR workflows. Record the
  // same check after running it on the committed candidate, so required checks
  // can be satisfied without a PAT or bypassing repository review requirements.
  const checkFile = resolve(mkdtempSync(resolve(tmpdir(), 'little-say-check-')), 'check.json');
  writeFileSync(checkFile, JSON.stringify({ name: 'check', head_sha: head, status: 'completed', conclusion: 'success', completed_at: new Date().toISOString(), details_url: `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`, output: { title: 'Release candidate checks passed', summary: 'npm run check passed on this exact committed version-only candidate.' } }));
  run('gh', ['api', `repos/${repo}/check-runs`, '--method', 'POST', '--input', checkFile], { capture: true });
  let url = pr?.url;
  if (!url) {
    const body = resolve(mkdtempSync(resolve(tmpdir(), 'little-say-release-')), 'body.md');
    writeFileSync(body, `Prepare server ${version}. Only server version fields change; native versions stay independent.\n\nValidation: npm run check passed on this exact release content. The Cut server release run publishes the merged commit automatically. If review or merge rules block the run, complete the normal merge process and re-run failed jobs in that same run. No commit SHA is required.\n`);
    url = run('gh', ['pr', 'create', '--repo', repo, '--base', base, '--head', branch, '--title', `Release server ${version}`, '--body-file', body], { capture: true });
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Release PR: ${url}\n\nIf branch protection requires review or checks, merge the PR normally, then **re-run failed jobs in this Cut server release run** to continue publication.\n`);
  console.log(url);
  // Never bypass branch protection or publish an unmerged candidate.
  run('gh', ['pr', 'merge', url, '--squash', '--match-head-commit', head]);
  pr = JSON.parse(run('gh', ['pr', 'view', url, '--json', 'state,mergeCommit'], { capture: true }));
  publishCommit(pr, base);
}

if (isMain(import.meta.url)) {
  try { cutServerRelease(); } catch (error) { fail(error); }
}
