/** @file Independently replays diagnostic code against immutable actual Actions outputs; no subprocess or pod execution. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import YAML from '../little-say-qa/node_modules/yaml/dist/index.js';
import assert from 'node:assert/strict';
const root=resolve('little-say-qa'), evidence=resolve('final49/macos/raw-artifact');
const old=execFileSync('git',['show','06b4b00e6657a9b654bda59ff6561332d0bbabf1:scripts/release/ios-pods-check.mjs'],{cwd:root,encoding:'utf8'});
const current=readFileSync(join(root,'scripts/release/ios-pods-check.mjs'),'utf8');
function replay(source,side){
 const dir=join(evidence,side), raw=JSON.parse(readFileSync(join(dir,'result.json'),'utf8'));
 const files=new Map(),fds=new Map();let index=0;
 const process={platform:'darwin',argv:['node','check','checkout',raw.source,side,'output'],env:{ImageOS:'macos26',ImageVersion:'20260907.0351.1'},exitCode:0};
 const code=source.replace(/^import .*;\r?$/gm,'').replace('new URL(import.meta.url)',"'diagnostic-script'");
 files.set('diagnostic-script',source);
 for(const [path,name] of [['package-lock.json','package-lock.json'],['apps/mobile/app.config.js','app.config.js']])files.set(resolve('checkout',path),readFileSync(join(dir,name),'utf8'));
 const logs=['source','status','node','npm','ruby','cocoapods','xcode','os','npm-ci','prebuild','pod-install'];
 runInNewContext(code,{process,resolve,join,createHash,console:{log(){}},mkdirSync(){},closeSync(){},
  existsSync:p=>files.has(p),readFileSync:p=>{assert(files.has(p),p);return files.get(p)},
  openSync(p){let fd=fds.size+1;fds.set(fd,p);files.set(p,'');return fd},
  writeFileSync:(p,v)=>files.set(p,v),copyFileSync:(a,b)=>files.set(b,files.get(a)),
  spawnSync(command,args,opts){
   const expected=raw.commands[index],name=logs[index++];assert.equal(command,expected.command);
   if(name!=='prebuild')assert.deepEqual(Array.from(args),expected.args);
   else {assert.deepEqual(Array.from(args).slice(1),['prebuild','--platform','ios','--no-install']);for(const n of ['Podfile','Podfile.properties.json'])files.set(resolve('checkout/apps/mobile/ios',n),readFileSync(join(dir,n),'utf8'));}
   assert.equal(opts.env.EXPO_NO_DOTENV,'1');assert.equal(opts.env.LITTLE_SAY_GOOGLE_IOS_URL_SCHEME,'');
   if(name==='pod-install'&&side==='fix')files.set(resolve('checkout/apps/mobile/ios/Podfile.lock'),readFileSync(join(dir,'Podfile.lock'),'utf8'));
   files.set(fds.get(opts.stdio[1]),readFileSync(join(dir,name+'.log'),'utf8'));return {status:expected.status};
  }});
 assert.equal(index,raw.commands.length);
 return {status:process.exitCode,record:JSON.parse(files.get(resolve('output/result.json')))};
}
const before=replay(old,'fix'),after=replay(current,'fix'),baseline=replay(current,'baseline');
assert.equal(before.status,1);assert.equal(after.status,0);assert.equal(baseline.status,0);
const pods=YAML.parse(readFileSync(join(evidence,'fix/Podfile.lock'),'utf8')).PODS;
const independent=Object.fromEntries(Object.keys(after.record.podVersions).map(name=>{const entry=pods.map(p=>typeof p==='string'?p:Object.keys(p)[0]).find(p=>p.startsWith(name+' ('));return [name,entry.match(/\(([^)]+)\)/)[1]]}));
for(const [name,version] of Object.entries(independent))assert.equal(after.record.podVersions[name].observed,version);
writeFileSync('final49/replay-result.json',JSON.stringify({method:'Actual unchanged old/final scripts in VM with original macOS subprocess outputs and raw Podfile.lock. No macOS execution or new workflow claimed.',oldSourceSha256:createHash('sha256').update(old).digest('hex'),finalSourceSha256:createHash('sha256').update(current).digest('hex'),before,after,baseline,independentYamlVersions:independent},null,2)+'\n');
console.log(JSON.stringify({oldParserStatus:before.status,finalParserStatus:after.status,baselineStatus:baseline.status,independentYamlVersions:independent}));
