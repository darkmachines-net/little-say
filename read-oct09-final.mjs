/** @file Retains complete paginated live PR scope, feedback, and CI readbacks without mutating GitHub. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const out = path.resolve('evidence-oct09-publish'); fs.mkdirSync(out, {recursive:true});
const api = endpoint => JSON.parse(execFileSync('gh',['api',endpoint],{encoding:'utf8'}));
const pages = endpoint => { const all=[]; for(let page=1;;page++){const r=api(`${endpoint}?per_page=100&page=${page}`); all.push(...r); if(r.length<100)return all;} };
const save=(file,data)=>fs.writeFileSync(path.join(out,file),JSON.stringify(data,null,2)+'\n');
const base='repos/MChartier/little-say'; const pr=api(`${base}/pulls/35`);
const master=api(`${base}/git/ref/heads/master`).object.sha;
if(pr.head.sha!=='29e8fa8cf04ce93e28f1c2b98e834283a2b8e389'||master!=='18aa7c08615ecf60c8583f0590dcce8ed389f0ea')throw new Error('Source or target drift');
save('pr-readback.json',pr); save('issue-readback.json',api(`${base}/issues/23`));
const commits=pages(`${base}/pulls/35/commits`), files=pages(`${base}/pulls/35/files`);
if(commits.length!==pr.commits||files.length!==pr.changed_files)throw new Error('Truncated scope');
save('published-commits.json',commits); save('published-files.json',files);
save('feedback.json',{issueComments:pages(`${base}/issues/23/comments`),prComments:pages(`${base}/issues/35/comments`),reviews:pages(`${base}/pulls/35/reviews`),inline:pages(`${base}/pulls/35/comments`)});
save('checks.json',api(`${base}/commits/${pr.head.sha}/check-runs`));
const threads=JSON.parse(execFileSync('gh',['api','graphql','-f','query=query { repository(owner:"MChartier",name:"little-say") { pullRequest(number:35) { reviewThreads(first:100) { nodes { id isResolved comments(first:100) { nodes { body updatedAt } pageInfo { hasNextPage } } } pageInfo { hasNextPage } } } } }'],{encoding:'utf8'}));
if(threads.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage||threads.data.repository.pullRequest.reviewThreads.nodes.some(n=>n.comments.pageInfo.hasNextPage))throw new Error('Thread pagination needed');save('review-threads.json',threads);
const bindings={checkedAtUtc:new Date().toISOString(),head:pr.head.sha,actualTarget:master,apiBase:pr.base.sha,targetRef:pr.base.ref,targetRepository:pr.base.repo.full_name,mergeBase:execFileSync('git',['-C','little-say-pr35','merge-base',pr.head.sha,master],{encoding:'utf8'}).trim(),parentRevisions:[],draft:pr.draft,labels:pr.labels.map(l=>l.name),commits:commits.map(c=>({sha:c.sha,parents:c.parents.map(p=>p.sha),message:c.commit.message})),fileCount:files.length,additions:pr.additions,deletions:pr.deletions,prBodySha256:createHash('sha256').update(pr.body).digest('hex')};
save('bindings.json',bindings); console.log(JSON.stringify(bindings,null,2));


