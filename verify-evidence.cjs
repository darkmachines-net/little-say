const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const git=(...a)=>cp.execFileSync('git',['-C','qa-head',...a]);
const ref='e652fa1ed0bd9c8f4d59f7eae05ac9abdb22264f';
const manifest=JSON.parse(git('show',`${ref}:manifest.json`));
const report={manifestSha256:sha(git('show',`${ref}:manifest.json`)),artifacts:[],sourceBlobs:[]};
for(const x of manifest.artifactDigests){const actual=sha(git('show',`${ref}:${x.file}`));assert.equal(actual,x.sha256);report.artifacts.push({file:x.file,sha256:actual});}
for(const x of manifest.source){const actual=git('rev-parse',`${manifest.head}:${x.file}`).toString().trim();assert.equal(actual,x.blob);report.sourceBlobs.push({file:x.file,blob:actual});}
for(const file of ['payloads','presets']) assert.deepEqual(git('show',`${ref}:before/${file}.json`),git('show',`${ref}:after/${file}.json`));
report.beforeAfterBytesEqual=true;
report.allEvidencePaths=git('ls-tree','-r','--name-only',ref).toString().trim().split('\n');
const payload=JSON.parse(fs.readFileSync('owner-evidence/before/payloads.json'));report.payloadKeys=Object.keys(payload);
const test=fs.readFileSync('qa-head/apps/server/test/prompt-payloads.test.ts','utf8');report.unicodeFixture=test.split('\n').find(l=>l.startsWith('const data'));
const api=JSON.parse(cp.execFileSync('gh',['api',`repos/MChartier/little-say/contents/manifest.json?ref=${ref}`],{encoding:'utf8'}));assert.equal(sha(Buffer.from(api.content,'base64')),report.manifestSha256);report.githubExactManifestAccessible=true;
const config=JSON.parse(cp.execFileSync('gh',['api','repos/MChartier/agentic-development-workflow/contents/deployments/calibrate-zbook.json?ref=f0919b184b6344d6279178b2388190936ca432a9'],{encoding:'utf8'}));fs.writeFileSync('records/pinned-deployment.json',Buffer.from(config.content,'base64'));
fs.writeFileSync('records/evidence-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
