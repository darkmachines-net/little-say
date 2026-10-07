/** @file Independent exact-byte validation of retained PR36 evidence and isolated runtimes. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const sha=b=>createHash('sha256').update(b).digest('hex'),base='evidence-pr36',commit='e4eb01aa9a31ad4c288c9268af9cd6ee4dd4d59a';
const read=p=>fs.readFileSync(path.join(base,p));const j=p=>JSON.parse(read(p));const m=j('manifest.json'),b=j('bindings.json');const checks=[];
function verify(p,expected){const actual=sha(read(p));assert.equal(actual,expected,p);checks.push({path:p,sha256:actual});}
verify('manifest.json',b.manifestSha256);verify('capture-editor.mjs',b.harnessSha256);verify('fixture.json',m.matching.fixtureSha256);verify('superseded-fixed-clock/manifest.json',b.supersededManifestSha256);
for(const log of b.retainedLogs)verify(log.file,log.sha256);
for(const [prefix,manifest] of [['',m],['superseded-fixed-clock/',j('superseded-fixed-clock/manifest.json')]]){
 verify(prefix+'capture-editor.mjs',manifest.harnessSha256);verify(prefix+'fixture.json',manifest.matching.fixtureSha256);
 for(const source of manifest.sources){assert.equal(source.sourceSha,source.side==='before'?b.parent:b.head);assert(source.listenerPids.includes(source.processId));assert(source.finalListenerPids.includes(source.processId));assert.equal(source.status,'');
  if(!prefix){verify(`builds/${source.side}/server/index.js`,source.serverSha256);for(const file of source.buildFiles)verify(`builds/${source.side}/web/${file.path}`,file.sha256);}
  for(const c of source.captures){verify(prefix+c.filename,c.sha256);for(const loaded of c.loadedBundles){const file=source.buildFiles.find(x=>'/'+x.path===loaded.url);assert(file);assert.equal(file.sha256,loaded.sha256);}}
  if(source.video)verify(prefix+source.video.filename,source.video.sha256);
 }
}
const remote=[];for(const file of ['README.md','manifest.json','bindings.json',...m.sources.flatMap(s=>s.captures.map(c=>c.filename))]){
 const blob=execFileSync('git',['-C',base,'rev-parse',`${commit}:${file}`],{encoding:'utf8'}).trim();const api=JSON.parse(execFileSync('gh',['api',`repos/MChartier/little-say/git/blobs/${blob}`],{encoding:'utf8',maxBuffer:30e6}));const bytes=Buffer.from(api.content,'base64');assert.equal(sha(bytes),sha(read(file)));remote.push({file,gitBlob:blob,sha256:sha(bytes)});
}
const deps=path.resolve('runtime/after/node_modules');for(const side of ['before','after']){const dst=path.resolve('runtime-pr36',side);fs.mkdirSync(`${dst}/apps/server`,{recursive:true});fs.cpSync(`${base}/builds/${side}/web`,`${dst}/web`,{recursive:true});fs.copyFileSync(`${base}/builds/${side}/server/index.js`,`${dst}/apps/server/index.mjs`);if(!fs.existsSync(`${dst}/node_modules`))fs.symlinkSync(deps,`${dst}/node_modules`,'junction');}
const result={checkedAtUtc:new Date().toISOString(),commit,verifiedFileHashes:checks,remoteAccessibleFiles:remote,sourceCommits:m.sources.map(s=>({side:s.side,sha:s.sourceSha,serverSha256:s.serverSha256})),runtime:'Exact retained web/server bytes copied into isolated runtime-pr36; existing lock-identical dependencies read through a junction, no product changes.'};
fs.writeFileSync('pr36-evidence-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify({checkedAtUtc:result.checkedAtUtc,verifiedFileHashes:checks.length,remoteAccessibleFiles:remote.length}));
