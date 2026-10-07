/** @file Independently recaptures full requests against isolated base/head sources with shared locked external dependencies. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=process.cwd(),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const posix=p=>p.replaceAll('\\','/');
if(!fs.existsSync('node_modules'))fs.symlinkSync(path.resolve('qa-head/node_modules'),'node_modules','junction');
if(!fs.existsSync('qa-base/node_modules'))fs.symlinkSync(path.resolve('qa-head/node_modules'),'qa-base/node_modules','junction');
for(const phase of ['base','head']){
 const source=posix(path.resolve(`qa-${phase}`));const out=posix(path.resolve(`records/reproduce-${phase}`));fs.mkdirSync(out,{recursive:true});
 let test=fs.readFileSync('qa-head/apps/server/test/prompt-payloads.test.ts','utf8');
 test="import {writeFileSync} from 'node:fs';\n"+test.replaceAll("'../src/",`'${source}/apps/server/src/`);
 test=test.replace('const observed: Record<string, string> = {};','const observed: Record<string, string> = {}; const payloads: Record<string, unknown> = {};');
 test=test.replace('observed[name] = digest(value);','observed[name] = digest(value); payloads[name] = value;');
 test=test.replace('expect(observed).toMatchSnapshot();',`writeFileSync(${JSON.stringify(out+'/payloads.json')},JSON.stringify(payloads,null,2)+'\\n'); expect(Object.keys(payloads)).toHaveLength(30);`);
 fs.writeFileSync(out+'/payload.test.ts',test);
 const conversation=phase==='base'?`Array.from(readFileSync('${source}/apps/mobile/src/ui/AiConversation.tsx','utf8').matchAll(/'(Create six [^']+)'/g),m=>m[1])`:'[conversationPrompts.farm,conversationPrompts.snack,conversationPrompts.family]';
 fs.writeFileSync(out+'/presets.test.ts',`/** @file Captures baseline/current presets without changing product source. */\nimport {writeFileSync,readFileSync} from 'node:fs'; import {expect,it} from 'vitest'; import {starterPrompt,starterTopics} from '${source}/packages/core/src/onboarding'; ${phase==='head'?`import {conversationPrompts} from '${source}/packages/core/src/promptPresets';`:''}\nit('captures presets',()=>{const conversation=${conversation};expect(conversation).toHaveLength(3);writeFileSync(${JSON.stringify(out+'/presets.json')},JSON.stringify({topics:starterTopics,starters:starterTopics.map(t=>starterPrompt(t.id)),conversation},null,2)+'\\n');});`);
 fs.writeFileSync(out+'/vitest.config.mjs',`import {defineConfig} from 'vitest/config';export default defineConfig({root:${JSON.stringify(posix(root))},resolve:{alias:{'@little-say/core':${JSON.stringify(source+'/packages/core/src/index.ts')}}},test:{include:[${JSON.stringify(out+'/*.test.ts')}],maxWorkers:1,testTimeout:10000}});`);
 const result=cp.spawnSync(process.execPath,['qa-head/node_modules/vitest/vitest.mjs','run','--config',out+'/vitest.config.mjs'],{cwd:root,encoding:'utf8',windowsHide:true});fs.writeFileSync(out+'/run.log',result.stdout+result.stderr);console.log(phase,result.status,result.stdout,result.stderr);assert.equal(result.status,0);
}
const report={};for(const file of ['payloads','presets']){const base=fs.readFileSync(`records/reproduce-base/${file}.json`),head=fs.readFileSync(`records/reproduce-head/${file}.json`);assert.deepEqual(base,head);assert.deepEqual(base,fs.readFileSync(`owner-evidence/before/${file}.json`));report[file]={equal:true,ownerCaptureEqual:true,bytes:base.length,sha256:sha(base)};}
fs.writeFileSync('records/reproduction.json',JSON.stringify(report,null,2));console.log(report);
