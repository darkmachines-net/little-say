/** @file Captures actual isolated baseline/final apps with deterministic data and verified served bundle bytes. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from '../little-say-grid/node_modules/playwright/index.mjs';

const root = path.resolve(import.meta.dirname, '..');
const destination = path.join(root, 'records', process.argv[2] || 'ui-preview');
fs.mkdirSync(destination, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaOf = repo => execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const clock = '2026-10-07T00:00:00.000Z';
const scenes = [{ name: 'dense', count: 24, viewport: {width:390,height:844}, mode:'play' }];
const colors = ['sage', 'peach', 'butter', 'sky', 'lilac', 'rose'];
const labels = ['Water', 'I would like something to eat', 'All done', 'Please help me', 'More', 'Take a break', 'Thank you'];
const emoji = ['💧', '🍎', '✅', '🙋', '➕', '🌳', '💛'];
function fixture(count, mode) {
  const tiles = Array.from({ length: count }, (_, i) => ({ id: `card-${i}`, label: count > 7 ? (i === count - 1 ? 'Please help me find my favourite things' : `Word ${i + 1}`) : labels[i], speech: labels[i % labels.length], language: 'en-US', color: colors[i % 6], illustration: { kind: 'emoji', emoji: emoji[i % 7] } }));
  return { version: 2, settings: { backendUrl: '', voices: {}, activeBoardId: mode === 'play' ? 'balanced-board' : null, aiConsent: false, autoSpeech: false, languageProfile: { languages: ['en-US'], defaultLanguage: 'en-US' } }, boards: [{ id: 'balanced-board', title: 'My everyday words', revision: 0, createdAt: clock, updatedAt: clock, tiles }] };
}
async function checkFree(port) {
  await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(resolve)); });
}
function listener(port) {
  const pwsh = 'C:/Users/MChar/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
  return execFileSync(pwsh, ['-NoProfile', '-Command', `(Get-NetTCPConnection -State Listen -LocalPort ${port}).OwningProcess`], { encoding: 'utf8', windowsHide: true }).trim().split(/\s+/).map(Number);
}
function inventory(directory) {
  return fs.readdirSync(directory, { recursive: true }).filter(name => fs.statSync(path.join(directory, name)).isFile()).map(name => ({ path: name.replaceAll('\\', '/'), sha256: hash(fs.readFileSync(path.join(directory, name))) }));
}
const manifest = { purpose: 'Issue31 matched actual-app screenshots from clean committed source', clock, captureTool: 'Playwright with installed Microsoft Edge', deviceScaleFactor: 1, colorScheme: 'light', serviceWorkers: 'blocked identically in both contexts to prevent cached build/update interference; no UI elements hidden', syntheticData: 'fixture function in this retained harness; no real user data', scenes, sources: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
manifest.browserVersion = browser.version();
try {
  for (const [side, directory, port] of [['after', 'little-say-grid', 7414]]) {
    const repo = path.join(root, directory), webRoot = path.join(repo, 'apps/mobile/dist');
    await checkFree(port);
    const stdout = fs.openSync(path.join(destination, `${side}-server.log`), 'w');
    const server = spawn(process.execPath, [path.join(repo, 'apps/server/dist/index.js')], { cwd: path.join(repo, 'apps/server'), windowsHide: true, stdio: ['ignore', stdout, stdout], env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), WEB_ROOT: webRoot, ALLOWED_ORIGINS: `http://127.0.0.1:${port}`, AAC_OPENAI_KEY: '', OPENAI_API_KEY: '', DATABASE_URL: '', PGHOST: '', PGDATABASE: '', AAC_IMAGE_GENERATION: 'false' } });
    fs.closeSync(stdout);
    fs.writeFileSync(path.join(destination, `${side}-server-owner.json`), JSON.stringify({ pid: server.pid, executable: process.execPath, repo, port }));
    const origin = `http://127.0.0.1:${port}`;
    const source = { side, sourceSha: shaOf(repo), status: execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }), buildCommand: 'npm.cmd run build', serveCommand: 'node apps/server/dist/index.js with explicit WEB_ROOT, empty provider/database settings and dedicated loopback port', port, processId: server.pid, serverSha256: hash(fs.readFileSync(path.join(repo, 'apps/server/dist/index.js'))), buildFiles: inventory(webRoot), captures: [] };
    assert.equal(source.status, '', 'Capture requires a clean committed source tree');
    try {
      let healthy = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { if ((await fetch(`${origin}/api/health`)).ok) { healthy = true; break; } } catch {}
        if (server.exitCode !== null) throw Error(`Server exited: ${server.exitCode}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(healthy, 'Server not healthy');
      source.listenerPids = listener(port); assert(source.listenerPids.includes(server.pid), 'Serving PID mismatch');
      for (const scene of scenes) {
        const context = await browser.newContext({ viewport: scene.viewport, deviceScaleFactor: 1, colorScheme: 'light', serviceWorkers: 'block', locale: 'en-US', timezoneId: 'UTC' });
        const page = await context.newPage();
        const loaded = [], verifications = [], verificationErrors = [];
        await page.clock.setFixedTime(new Date(clock));
        await page.addInitScript(() => {
          const w = window;
          w.SpeechSynthesisUtterance = class { constructor(text = '') { this.text = text; } };
          Object.defineProperty(w, 'speechSynthesis', { configurable: true, value: { getVoices: () => [{ voiceURI: 'fixture', name: 'English', lang: 'en-US', localService: true, default: true }], speak() {}, cancel() {}, addEventListener() {}, removeEventListener() {} } });
          Element.prototype.requestFullscreen = async () => {};
        });
        page.on('response', response => {
          const url = new URL(response.url());
          if (response.status() === 200 && url.origin === origin && url.pathname.startsWith('/_expo/') && url.pathname.endsWith('.js')) {
            verifications.push((async () => {
              const bytes = await response.body(), relative = decodeURIComponent(url.pathname.slice(1));
              const expected = hash(fs.readFileSync(path.join(webRoot, relative))), actual = hash(bytes);
              assert.equal(actual, expected, 'Browser bundle differs from isolated build');
              loaded.push({ url: url.pathname, sha256: actual, bytes: bytes.length });
            })().catch(error => verificationErrors.push(error.message)));
          }
        });
        await page.goto(`${origin}/app`);
        await page.getByRole('heading', { name: 'Choose your languages', exact: true }).waitFor();
        const library = fixture(scene.count, scene.mode);
        await page.evaluate(async data => {
          const db = await new Promise(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
          await new Promise((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(data, 'library'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
        }, library);
        await page.reload();
        if (scene.mode === 'edit') {
          await page.getByRole('button', { name: 'Edit My everyday words', exact: true }).click();
          await page.getByTestId('editor-preview').waitFor();
        } else await page.getByTestId('play-board').waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);
        await Promise.all(verifications);
        assert.deepEqual(verificationErrors, [], 'Bundle verification errors');
        assert(loaded.some(item => item.url.includes('/App-')), 'Actual app bundle not verified');
        const filename = `${side}-${scene.name}.png`, file = path.join(destination, filename);
        console.log(await page.getByTestId('touch-surface').getByRole('button').last().evaluate(el => [...el.querySelectorAll('*')].map(e=>({ text:e.textContent, rect:e.getBoundingClientRect().toJSON(), font:getComputedStyle(e).fontSize, line:getComputedStyle(e).lineHeight, flex:getComputedStyle(e).flex, overflow:getComputedStyle(e).overflow })))); await page.screenshot({ path: file, animations: 'disabled' });
        const selector = scene.mode === 'edit' ? 'editor-preview' : 'touch-surface';
        const geometry = await page.getByTestId(selector).getByRole('button').evaluateAll(elements => elements.map(el => { const box = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label'), x: box.x, y: box.y, width: box.width, height: box.height }; }));
        source.captures.push({ scene: scene.name, route: '/app', setup: 'Fresh context; write synthetic fixture into IndexedDB state/library after database creation; reload; open existing editor only for edit mode', timeUtc: new Date().toISOString(), fixtureSha256: hash(Buffer.from(JSON.stringify(library))), filename, sha256: hash(fs.readFileSync(file)), loadedBundles: loaded, geometry });
        await context.close();
      }
      source.finalListenerPids = listener(port); assert(source.finalListenerPids.includes(server.pid));
    } finally { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
    manifest.sources.push(source);
  }
} finally { await browser.close(); }
manifest.harnessSha256 = hash(fs.readFileSync(import.meta.filename));
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ destination, browser: manifest.browserVersion, sources: manifest.sources.map(s => ({ side: s.side, sha: s.sourceSha, status: s.status, screenshots: s.captures.length })) }));

