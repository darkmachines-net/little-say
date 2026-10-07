const fs = require('node:fs');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const stage = process.argv[2] || 'initial';
const dir = `records/${stage}`; fs.mkdirSync(dir,{recursive:true});
function api(path, paged=false) { const r=cp.execFileSync('gh',['api',...(paged?['--paginate','--slurp']:[]),path],{encoding:'utf8'});return JSON.parse(r); }
const paths={pr:'pulls/35',issue:'issues/23',issueComments:'issues/23/comments?per_page=100',prComments:'issues/35/comments?per_page=100',reviews:'pulls/35/reviews?per_page=100',inline:'pulls/35/comments?per_page=100',commits:'pulls/35/commits?per_page=100',files:'pulls/35/files?per_page=100',base:'git/ref/heads/master',checks:'commits/ea87b78eb6c9e9612cc42b7eec490af9d8216b86/check-runs?per_page=100',status:'commits/ea87b78eb6c9e9612cc42b7eec490af9d8216b86/status'};
const results={};
for(const [k,p] of Object.entries(paths)){results[k]=api(`repos/MChartier/little-say/${p}`,p.includes('per_page'));fs.writeFileSync(`${dir}/${k}.json`,JSON.stringify(results[k],null,2));}
const query='query { repository(owner:"MChartier",name:"little-say") { pullRequest(number:35) { reviewThreads(first:100) { pageInfo {hasNextPage endCursor} nodes { id isResolved isOutdated comments(first:100) {pageInfo {hasNextPage endCursor} nodes {id body updatedAt url author{login}}}}} closingIssuesReferences(first:100){nodes{number url}} } } }';
const graph=JSON.parse(cp.execFileSync('gh',['api','graphql','-f',`query=${query}`],{encoding:'utf8'}));fs.writeFileSync(`${dir}/threads.json`,JSON.stringify(graph,null,2));
const pr=results.pr;
const summary={checkedAtUtc:new Date().toISOString(),host:cp.execFileSync('hostname',{encoding:'utf8'}).trim(),headSha:pr.head.sha,headRef:pr.head.ref,headRepo:pr.head.repo.full_name,baseSha:pr.base.sha,baseRef:pr.base.ref,baseRepo:pr.base.repo.full_name,liveMaster:results.base.object.sha,prBodySha256:crypto.createHash('sha256').update(pr.body,'utf8').digest('hex'),commits:results.commits.flat().map(c=>({sha:c.sha,parents:c.parents.map(p=>p.sha)})),files:results.files.flat().map(f=>({filename:f.filename,previous_filename:f.previous_filename,status:f.status,additions:f.additions,deletions:f.deletions})),prTotals:{commits:pr.commits,changed_files:pr.changed_files,additions:pr.additions,deletions:pr.deletions}};
fs.writeFileSync(`${dir}/summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
