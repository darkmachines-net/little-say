/** @file Reads all current PR scope/feedback pages and binds the final publication for coordinator QA handoff. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const api = endpoint => JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
const pages = endpoint => JSON.parse(execFileSync('gh', ['api', endpoint, '--paginate', '--slurp'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })).flat();
const repo = 'repos/MChartier/little-say';
const pr = api(`${repo}/pulls/35`);
const commits = pages(`${repo}/pulls/35/commits?per_page=100`);
const files = pages(`${repo}/pulls/35/files?per_page=100`);
const comments = pages(`${repo}/issues/35/comments?per_page=100`);
const reviews = pages(`${repo}/pulls/35/reviews?per_page=100`);
const inline = pages(`${repo}/pulls/35/comments?per_page=100`);
const issue = api(`${repo}/issues/23`);
const issueComments = pages(`${repo}/issues/23/comments?per_page=100`);
const query = 'query { repository(owner:"MChartier",name:"little-say") { pullRequest(number:35) { reviewThreads(first:100) { nodes { id isResolved isOutdated comments(first:100) { nodes { id body url updatedAt } pageInfo { hasNextPage } } } pageInfo { hasNextPage } } closingIssuesReferences(first:100) { nodes { number url } } } } }';
const graph = JSON.parse(execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`], { encoding: 'utf8' })).data.repository.pullRequest;
if (graph.reviewThreads.pageInfo.hasNextPage || graph.reviewThreads.nodes.some(thread => thread.comments.pageInfo.hasNextPage)) throw new Error('Truncated thread inventory');
if (commits.length !== pr.commits || files.length !== pr.changed_files) throw new Error('Incomplete published scope inventory');
const base = '1f0329052bd46b1e953c5adb5ad7e59ba2f2dcc4';
const head = 'ea87b78eb6c9e9612cc42b7eec490af9d8216b86';
if (pr.head.sha !== head || pr.base.sha !== base || commits.length !== 1 || commits[0].parents.length !== 1 || commits[0].parents[0].sha !== base) throw new Error('Unexpected revision or commit-parent drift');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const evidence = 'e652fa1ed0bd9c8f4d59f7eae05ac9abdb22264f';
const tree = api(`${repo}/git/trees/${evidence}?recursive=1`);
if (tree.truncated) throw new Error('Truncated evidence tree');
const localTree = execFileSync('git', ['ls-tree', '-r', evidence], { cwd: 'evidence-publish', encoding: 'utf8' }).trim().split('\n');
for (const row of localTree) {
  const [metadata, name] = row.split('\t'); const blob = metadata.split(' ')[2];
  if (!tree.tree.some(entry => entry.path === name && entry.sha === blob)) throw new Error('Remote evidence mismatch: ' + name);
}
const manifestResource = api(`${repo}/contents/manifest.json?ref=${evidence}`);
const manifestBytes = Buffer.from(manifestResource.content, 'base64');
if (sha(manifestBytes) !== '96c59178d5fb560a3b6a77e2b95a7ac5ad0034fcd5d53e21bba8efd196f527b3') throw new Error('Evidence manifest changed');
const checks = api(`${repo}/commits/${head}/check-runs?per_page=100`);
const record = {
  checkedAtUtc: new Date().toISOString(), pullRequest: pr.html_url, issue: issue.html_url,
  actualTarget: { repository: pr.base.repo.full_name, ref: pr.base.ref, sha: pr.base.sha }, head: pr.head.sha,
  mergeBase: base, parentRevisions: [], ultimateTarget: 'MChartier/little-say/master',
  prBodySha256: sha(Buffer.from(pr.body, 'utf8')), prBody: pr.body, issueBodySha256: sha(Buffer.from(issue.body, 'utf8')),
  commits: commits.map(commit => ({ sha: commit.sha, parents: commit.parents.map(parent => parent.sha), message: commit.commit.message, scope: 'Issue23 exact resource extraction, typed loading/substitution and necessary regression/packaging tests.' })),
  files: files.map(file => ({ filename: file.filename, previousFilename: file.previous_filename ?? null, status: file.status, additions: file.additions, deletions: file.deletions, rationale: file.filename.includes('.test.') || file.filename.includes('__snapshots__') ? 'Maintained prompt/packaging regression contract' : file.filename === 'prompts/README.md' ? 'Maintained resource caller/substitution and packaging guide' : 'Scoped production resource, typed helper or existing prompt/preset caller' })),
  scopeTotals: { commits: pr.commits, files: pr.changed_files, additions: pr.additions, deletions: pr.deletions },
  evidence: { commit: evidence, manifestSha256: sha(manifestBytes), remoteTreeFilesVerified: localTree.length },
  issueComments, comments, reviews, inline, threads: graph.reviewThreads.nodes, closingIssues: graph.closingIssuesReferences.nodes,
  issueFeedbackDispositions: issueComments.map(comment => ({ id: comment.id, body: comment.body, disposition: comment.id === 6029576641 ? 'Executed scoped extraction from reverified actual master under assigned sole owner. Exact preset/import boundary preserved; no deferred grants, editor/layout, package-script or Docker changes. Independent QA remains pending.' : 'Requires explicit assessment; not treated as resolved by this script.' })),
  feedbackDispositions: comments.map(comment => ({ id: comment.id, url: comment.html_url, updatedAt: comment.updated_at, body: comment.body, disposition: comment.id === 6029846176 ? 'Quota-only bot refusal; no completed bot review claimed, no retry. Independent review/QA still required under direct amendment.' : comment.body === '@codex review' ? 'Single configured bot-review request; quota refusal recorded.' : comment.id === 6029880624 ? 'Implementation status comment records the exact quota-only refusal and independent-QA requirement; no actionable code request.' : 'Requires explicit assessment; not treated as resolved by this script.' })),
  checkRuns: checks.check_runs.map(check => ({ id: check.id, name: check.name, status: check.status, conclusion: check.conclusion, url: check.html_url, startedAt: check.started_at, completedAt: check.completed_at })),
  independentQa: 'Pending coordinator assignment; implementer does not award readiness.', isDraft: pr.draft, labels: pr.labels.map(label => label.name),
};
fs.writeFileSync(path.resolve('evidence-publish/publication.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ head, base, bodySha256: record.prBodySha256, totals: record.scopeTotals, feedback: { comments: comments.length, reviews: reviews.length, inline: inline.length, threads: record.threads.length }, checks: record.checkRuns, evidenceAccessVerified: record.evidence }, null, 2));
