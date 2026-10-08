/** @file Independently probes exact prompt substitution and verifies captured contract and client bundle bytes. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { loadPromptResource, loadPromptTemplate } from '../little-say-qa/packages/core/src/promptResources.ts';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const hostile='牛 "quoted" \\ $& $` $\' $$ {{b}}\nnext';
assert.equal(loadPromptTemplate('\n{{a}}|{{b}}|{{a}}\n',['a','b'],'probe')({a:hostile,b:'{{a}}'}),'\n'+hostile+'|{{a}}|'+hostile+'\n');
for(const x of [null,[],{}, {text:3},{text:''},{text:' \n'}])assert.throws(()=>loadPromptResource(x,['text'],'probe'));
for(const x of ['none','{{wrong}}','{{a}} {{unknown}}'])assert.throws(()=>loadPromptTemplate(x,['a'],'probe'));
assert.throws(()=>loadPromptTemplate('{{a}}',['a'],'probe')({a:undefined}));
const out={node:process.version,literalAndInvalidResourceProbe:'pass',captures:{},bundles:[]};
for(const f of ['payloads.json','presets.json']){let b=fs.readFileSync('reassess35/owner/before/'+f),a=fs.readFileSync('reassess35/owner/after/'+f);assert.deepEqual(b,a);out.captures[f]={sha256:hash(a),keys:Object.keys(JSON.parse(a))};}
const root=path.resolve('../task-9/little-say-pr35');
const runtime=JSON.parse(fs.readFileSync('reassess35/owner/runtime-report.json'));
const server=Object.values(JSON.parse(fs.readFileSync('little-say-qa/prompts/server/board.json'))).concat(Object.values(JSON.parse(fs.readFileSync('little-say-qa/prompts/server/pictures.json'))),Object.values(JSON.parse(fs.readFileSync('little-say-qa/prompts/server/speech.json'))));
for(const platform of runtime.bundles){const all=[];for(const f of platform.files){let bytes=fs.readFileSync(path.join(root,f.file));assert.equal(bytes.length,f.bytes);assert.equal(hash(bytes),f.sha256);all.push(bytes);}
for(const s of server){const marker=s.replace(/^\{\{[^}]+\}\} /,'').trimStart().slice(0,75);assert(!all.some(x=>x.includes(Buffer.from(marker))));}
for(const marker of ['Create a starter soundboard with exactly six cards','Create six farm animal tiles','Create six things a toddler','Create six family tiles'])assert(all.some(x=>x.includes(Buffer.from(marker))));out.bundles.push({platform:platform.platform,exactHashesMatch:true,allServerMarkersAbsent:true,sharedMarkersPresent:true});}
fs.writeFileSync('reassess35/independent-result.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
