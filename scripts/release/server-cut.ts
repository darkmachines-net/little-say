import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { assert, cleanCommit, fail, git, npm, readJson, root, run } from './common';
import { prepare, serverFiles, validateCommit } from './version';

try {
  assert(process.env.GITHUB_ACTIONS === 'true', 'Cut server releases from the GitHub Actions workflow.');
  const base = process.env.DEFAULT_BRANCH!;
  assert(base && process.env.GITHUB_REF === `refs/heads/${base}`, 'Run this workflow on the default branch.');
  const repo = process.env.GITHUB_REPOSITORY!;
  const commit = cleanCommit();
  assert(git(['ls-remote', 'origin', `refs/heads/${base}`]).split(/\s/)[0] === commit, 'Default branch moved. Run Cut server release again.');
  const open = JSON.parse(run('gh', ['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'headRefName,url'], { capture: true }));
  assert(!open.some((pr: any) => pr.headRefName.startsWith('release/server-')), 'A server release PR is already open. Finish or close it first.');
  prepare('server', process.env.RELEASE_BUMP || 'patch');
  const version = readJson(resolve(root, 'release.json')).version;
  const branch = `release/server-${version}`;
  git(['switch', '-c', branch]);
  git(['config', 'user.name', 'github-actions[bot]']);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  git(['add', '--', ...serverFiles]);
  git(['commit', '-m', `Release server ${version}`]);
  const head = git(['rev-parse', 'HEAD']);
  validateCommit(head);
  npm(['run', 'check']);
  assert(cleanCommit() === head, 'Checks changed release source.');
  git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  // GITHUB_TOKEN-created pushes do not start normal push/PR workflows. Record the
  // same check after running it on the committed candidate, so required checks
  // can be satisfied without a PAT or bypassing repository review requirements.
  const checkFile = resolve(mkdtempSync(resolve(tmpdir(), 'little-say-check-')), 'check.json');
  writeFileSync(checkFile, JSON.stringify({ name: 'check', head_sha: head, status: 'completed', conclusion: 'success', completed_at: new Date().toISOString(), details_url: `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`, output: { title: 'Release candidate checks passed', summary: 'npm run check passed on this exact committed version-only candidate.' } }));
  run('gh', ['api', `repos/${repo}/check-runs`, '--method', 'POST', '--input', checkFile], { capture: true });
  const body = resolve(mkdtempSync(resolve(tmpdir(), 'little-say-release-')), 'body.md');
  writeFileSync(body, `Prepare server ${version}. Only server version fields change; native versions stay independent.\n\nValidation: npm run check passed on this exact release content. Merging alone does not publish an image. The cut workflow publishes this merged commit, or use Publish server image with the full merged SHA for recovery.\n`);
  const url = run('gh', ['pr', 'create', '--repo', repo, '--base', base, '--head', branch, '--title', `Release server ${version}`, '--body-file', body], { capture: true });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Release PR: ${url}\n\nIf branch protection requires review or checks, merge the PR normally, then run **Publish server image** with its full merge commit SHA.\n`);
  console.log(url);
  // Never bypass branch protection or publish an unmerged candidate.
  run('gh', ['pr', 'merge', url, '--squash', '--match-head-commit', head]);
  const pr = JSON.parse(run('gh', ['pr', 'view', url, '--json', 'state,mergeCommit'], { capture: true }));
  assert(pr.state === 'MERGED' && /^[a-f0-9]{40}$/.test(pr.mergeCommit?.oid), 'Release PR is awaiting merge. After merging, run Publish server image with the merge SHA.');
  assert(process.env.GITHUB_OUTPUT, 'Missing workflow output file.');
  appendFileSync(process.env.GITHUB_OUTPUT, `commit=${pr.mergeCommit.oid}\n`);
} catch (error) { fail(error); }
