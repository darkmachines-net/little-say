/** @file Independently verifies retained image, harness, fixture, build and published scope identities. */
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import {execFileSync} from 'node:child_process'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const root='retained-evidence', manifest=JSON.parse(fs.readFileSync(`${root}/ui-final2/manifest.json`));
const results={checkedAtUtc:new Date().toISOString(),manifestSha256:hash(fs.readFileSync(`${root}/ui-final2/manifest.json`)),harnessSha256:hash(fs.readFileSync(`${root}/capture-grid.mjs`)),images:[],fixtures:[],builds:[],scope:[]};
assert.equal(results.manifestSha256,'ad25d87e7d648ff7297d4a92219d4a9111a32988ea490ff57e4afc671a989214');
assert.equal(results.harnessSha256,manifest.harnessSha256);
const harness=fs.readFileSync(`${root}/capture-grid.mjs`,'utf8');
const fixtureCode=harness.slice(harness.indexOf('const colors ='),harness.indexOf('async function checkFree'));
const fixture=vm.runInNewContext(`const clock=${JSON.stringify(manifest.clock)};${fixtureCode};fixture`);
for(const source of manifest.sources){
  const local=`C:/Users/MChar/Documents/Codex/2026-10-06/task-8/${source.side==='before'?'little-say-before':'little-say-grid'}`;
  const files=[];
  for(const item of source.buildFiles){const actual=hash(fs.readFileSync(path.join(local,'apps/mobile/dist',item.path)));assert.equal(actual,item.sha256);files.push({...item,verified:true});}
  assert.equal(hash(fs.readFileSync(path.join(local,'apps/server/dist/index.js'))),source.serverSha256);
  results.builds.push({side:source.side,sourceSha:source.sourceSha,files,serverSha256:source.serverSha256});
  for(const c of source.captures){
    const png=fs.readFileSync(`${root}/ui-final2/${c.filename}`);assert.equal(hash(png),c.sha256);
    const scene=manifest.scenes.find(s=>s.name===c.scene);const f=fixture(scene.count,scene.mode);assert.equal(hash(JSON.stringify(f)),c.fixtureSha256);
    for(const b of c.loadedBundles)assert(source.buildFiles.some(i=>('/'+i.path)===b.url&&i.sha256===b.sha256));
    results.images.push({side:source.side,scene:c.scene,file:c.filename,sha256:c.sha256,width:png.readUInt32BE(16),height:png.readUInt32BE(20)});
    results.fixtures.push({side:source.side,scene:c.scene,sha256:c.fixtureSha256});
  }
}
for(const f of JSON.parse(fs.readFileSync('snapshot-initial/files.json'))){
 const blob=execFileSync('git',['-C','qa-worktree','rev-parse',`HEAD:${f.filename}`],{encoding:'utf8'}).trim();assert.equal(blob,f.sha);results.scope.push({path:f.filename,status:f.status,previousPath:f.previous_filename||null,blobSha:blob,additions:f.additions,deletions:f.deletions});
}
const index=JSON.parse(fs.readFileSync(`${root}/artifact-index.json`));console.log('Artifact index structure',Object.keys(index));
fs.writeFileSync('evidence-verification.json',JSON.stringify(results,null,2));
const deployment=JSON.parse(execFileSync('gh',['api','repos/MChartier/agentic-development-workflow/contents/deployments/calibrate-zbook.json?ref=f0919b184b6344d6279178b2388190936ca432a9'],{encoding:'utf8'}));fs.writeFileSync('deployment.json',Buffer.from(deployment.content,'base64'));
console.log(JSON.stringify({manifestSha256:results.manifestSha256,harnessSha256:results.harnessSha256,images:results.images,fixturesVerified:results.fixtures.length,buildFilesVerified:results.builds.map(b=>({side:b.side,count:b.files.length,sourceSha:b.sourceSha})),scopeFiles:results.scope.length},null,2));
