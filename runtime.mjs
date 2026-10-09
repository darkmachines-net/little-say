/** @file Independent exact-source iOS boundary and relocated ESM runtime check; no credentials or live inference. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
const root=path.resolve('little-say-qa'),evidence=path.resolve('recheck35');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const list=files(path.join(root,'apps/mobile/dist-qa-ios')).filter(f=>/\.(hbc|js)$/.test(f));assert(list.length);
const bytes=list.map(f=>fs.readFileSync(f));
for(const n of ['board','pictures','speech'])for(const text of Object.values(JSON.parse(fs.readFileSync(path.join(root,'prompts/server',n+'.json'))))){const marker=text.replace(/^\{\{[^}]+\}\} /,'').trimStart().slice(0,75);assert(!bytes.some(b=>b.includes(Buffer.from(marker))));}
for(const marker of ['Create a starter soundboard with exactly six cards','Create six farm animal tiles','Create six things a toddler','Create six family tiles'])assert(bytes.some(b=>b.includes(Buffer.from(marker))));
const report={sourceHead:'29e8fa8cf04ce93e28f1c2b98e834283a2b8e389',ios:{serverMarkersAbsent:true,sharedMarkersPresent:true,files:list.map(f=>({file:path.relative(root,f),bytes:fs.statSync(f).size,sha256:sha(fs.readFileSync(f))}))}};
const sourceCheck = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', "import { speechInstructions } from './apps/server/src/prompts.ts'; console.log(speechInstructions('fr-FR'));"], { cwd: root, encoding: 'utf8' });
if (sourceCheck.status !== 0) throw new Error(sourceCheck.stderr);
report.sourceTsx = { exitCode: sourceCheck.status, outputSha256: sha(sourceCheck.stdout) };
const runtime = path.join(evidence, 'runtime');
fs.mkdirSync(path.join(runtime, 'server'), { recursive: true });
fs.cpSync(path.join(root, 'apps/server/dist'), path.join(runtime, 'server'), { recursive: true });
fs.copyFileSync(path.join(root, 'apps/server/package.json'), path.join(runtime, 'package.json'));
if (!fs.existsSync(path.join(runtime, 'node_modules'))) fs.symlinkSync(path.join(root, 'node_modules'), path.join(runtime, 'node_modules'), 'junction');
const env = Object.fromEntries(['SystemRoot', 'Path', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { PORT: '14673', HOST: '127.0.0.1', NODE_ENV: 'production', AAC_OPENAI_KEY: '', OPENAI_API_KEY: '', SPEECH_CACHE_DIR: path.join(runtime, 'speech'), PICTURE_CACHE_DIR: path.join(runtime, 'pictures'), WEB_ROOT: path.join(runtime, 'web') });
const child = spawn(process.execPath, ['server/index.js'], { cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', data => log += data); child.stderr.on('data', data => log += data);
try {
  let response;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error('Runtime exited: ' + log);
    try { response = await fetch('http://127.0.0.1:14673/api/health'); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!response?.ok) throw new Error('Relocated runtime health failed: ' + log);
  report.runtime = { status: response.status, health: await response.json(), layout: ['server/*.js', 'package.json', 'external node_modules junction'], sourceOrPromptsDirectoriesCopied: false, serverBundleSha256: sha(fs.readFileSync(path.join(runtime, 'server/index.js'))) };
} finally { child.kill(); fs.writeFileSync(path.join(evidence, 'runtime.log'), log); }
fs.writeFileSync(path.join(evidence, 'runtime-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
