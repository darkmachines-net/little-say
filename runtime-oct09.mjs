/** @file Retains source, client-boundary and relocated server-runtime evidence for issue 23. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
const root = path.resolve('little-say-pr35');
const evidence = path.resolve('evidence-oct09');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]); }
const serverPrompts = Object.fromEntries(['board', 'pictures', 'speech'].flatMap(file => Object.entries(JSON.parse(fs.readFileSync(path.join(root, 'prompts/server', file + '.json')))).map(([key, value]) => [file + '.' + key, value])));
const report = { beforeAfterPayloadBytesEqual: fs.readFileSync(path.join(evidence, 'before/payloads.json')).equals(fs.readFileSync(path.join(evidence, 'after/payloads.json'))), beforeAfterPresetBytesEqual: fs.readFileSync(path.join(evidence, 'before/presets.json')).equals(fs.readFileSync(path.join(evidence, 'after/presets.json'))), bundles: [] };
if (!report.beforeAfterPayloadBytesEqual || !report.beforeAfterPresetBytesEqual) throw new Error('Payload mismatch');
for (const platform of ['web', 'android', 'ios']) {
  const dir = path.join(root, 'apps/mobile', platform === 'web' ? 'dist' : 'dist-native');
  const list = files(dir).filter(file => file.includes(`${path.sep}${platform}${path.sep}`) && /\.(js|hbc)$/.test(file));
  if (!list.length) throw new Error('No bundles for ' + platform);
  const contents = list.map(file => fs.readFileSync(file));
  for (const [key, value] of Object.entries(serverPrompts)) {
    const marker = value.replace(/^\{\{[^}]+\}\} /, '').trimStart().slice(0, 75);
    if (contents.some(bytes => bytes.includes(Buffer.from(marker)))) throw new Error(`Server prompt leaked to ${platform}: ${key}`);
  }
  for (const marker of ['Create a starter soundboard with exactly six cards', 'Create six farm animal tiles', 'Create six things a toddler', 'Create six family tiles']) {
    if (!contents.some(bytes => bytes.includes(Buffer.from(marker)))) throw new Error(`Shared prompt missing from ${platform}: ${marker}`);
  }
  report.bundles.push({ platform, serverPromptMarkersAbsent: Object.keys(serverPrompts), sharedPromptMarkersPresent: true, files: list.map(file => ({ file: path.relative(root, file), bytes: fs.statSync(file).size, sha256: sha(fs.readFileSync(file)) })) });
}
const sourceCheck = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', "import { speechInstructions } from './apps/server/src/prompts.ts'; console.log(speechInstructions('fr-FR'));"], { cwd: root, encoding: 'utf8' });
if (sourceCheck.status !== 0) throw new Error(sourceCheck.stderr);
report.sourceTsx = { exitCode: sourceCheck.status, outputSha256: sha(sourceCheck.stdout) };
const runtime = path.join(evidence, 'runtime');
fs.mkdirSync(path.join(runtime, 'server'), { recursive: true });
fs.cpSync(path.join(root, 'apps/server/dist'), path.join(runtime, 'server'), { recursive: true });
fs.copyFileSync(path.join(root, 'apps/server/package.json'), path.join(runtime, 'package.json'));
if (!fs.existsSync(path.join(runtime, 'node_modules'))) fs.symlinkSync(path.join(root, 'node_modules'), path.join(runtime, 'node_modules'), 'junction');
const env = Object.fromEntries(['SystemRoot', 'Path', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { PORT: '4599', HOST: '127.0.0.1', NODE_ENV: 'production', AAC_OPENAI_KEY: '', OPENAI_API_KEY: '', SPEECH_CACHE_DIR: path.join(runtime, 'speech'), PICTURE_CACHE_DIR: path.join(runtime, 'pictures'), WEB_ROOT: path.join(runtime, 'web') });
const child = spawn(process.execPath, ['server/index.js'], { cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', data => log += data); child.stderr.on('data', data => log += data);
try {
  let response;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error('Runtime exited: ' + log);
    try { response = await fetch('http://127.0.0.1:4599/api/health'); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!response?.ok) throw new Error('Relocated runtime health failed: ' + log);
  report.runtime = { status: response.status, health: await response.json(), layout: ['server/*.js', 'package.json', 'external node_modules junction'], sourceOrPromptsDirectoriesCopied: false, serverBundleSha256: sha(fs.readFileSync(path.join(runtime, 'server/index.js'))) };
} finally { child.kill(); fs.writeFileSync(path.join(evidence, 'runtime.log'), log); }
fs.writeFileSync(path.join(evidence, 'runtime-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
