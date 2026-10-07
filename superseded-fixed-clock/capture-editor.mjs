/** @file Captures matched isolated parent/final apps, binding source, served bundles, fixtures, originals and motion. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from './little-say/node_modules/playwright/index.mjs';

const root = import.meta.dirname;
const destination = path.join(root, 'editor-evidence');
fs.mkdirSync(destination, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const clock = '2026-10-07T00:00:00.000Z';
const scenes = [
  { name: 'wide', viewport: { width: 1180, height: 820 } },
  { name: 'portrait', viewport: { width: 390, height: 844 } },
  { name: 'short-landscape', viewport: { width: 844, height: 390 } },
];
const library = {
  version: 2,
  settings: { backendUrl: '', voices: {}, activeBoardId: 'everyday', aiConsent: false, autoSpeech: false, languageProfile: { languages: ['en-US'], defaultLanguage: 'en-US' } },
  boards: [{ id: 'everyday', title: 'My everyday words', revision: 0, createdAt: clock, updatedAt: clock,
    tiles: ['Water', 'Something to eat', 'All done', 'Please help me'].map((label, i) => ({ id: `card-${i}`, label, speech: label, language: 'en-US', color: ['sage', 'peach', 'butter', 'sky'][i], illustration: { kind: 'emoji', emoji: ['💧', '🍎', '✅', '🙋'][i] } })) }],
};
fs.writeFileSync(path.join(destination, 'fixture.json'), JSON.stringify(library, null, 2));
function inventory(directory) {
  return fs.readdirSync(directory, { recursive: true }).filter(name => fs.statSync(path.join(directory, name)).isFile()).map(name => ({ path: name.replaceAll('\\', '/'), sha256: hash(fs.readFileSync(path.join(directory, name))) }));
}
async function checkFree(port) {
  await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(resolve)); });
}
function listener(port) {
  const pwsh = 'C:/Users/MChar/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
  return execFileSync(pwsh, ['-NoProfile', '-Command', `(Get-NetTCPConnection -State Listen -LocalPort ${port}).OwningProcess`], { encoding: 'utf8', windowsHide: true }).trim().split(/\s+/).map(Number);
}
const manifest = {
  purpose: 'Issue30 genuine matched parent-to-child UI and supplemental direct-return/motion evidence',
  ownerTask: '01a11406-66b3-71fb-a4cc-2aad6d51802c',
  parent: 'b21d3ba7370c08468b868385ce9df3d875eee799', ultimateTargetAtDispatch: '1f0329052bd46b1e953c5adb5ad7e59ba2f2dcc4',
  clock, captureTool: 'Playwright with installed Microsoft Edge on Windows ZBook; browser evidence, not native device evidence',
  matching: { deviceScaleFactor: 1, colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'no-preference', serviceWorkers: 'blocked identically to exclude cached bundles and update notices; no DOM/UI hiding', audio: 'synthetic system-voice driver, no provider calls', fullscreen: 'requestFullscreen normalized to a no-op on both sources to keep viewport stable', fixture: 'fixture.json', fixtureSha256: hash(fs.readFileSync(path.join(destination, 'fixture.json'))) },
  setup: 'Fresh browser context; create local IndexedDB via first setup screen; put fixture into state/library and reload into play. Hold the parent control for 2100 ms and release on each source. Before shows its actual confirmation; After shows the existing editor. Supplementary After captures scroll existing controls or return to play. No images edited.',
  buildCommands: ['npm.cmd run build -w @little-say/server', 'cd apps/mobile; node ../../node_modules/expo/bin/cli export --platform web --max-workers 2', 'node scripts/build-pwa.mjs'],
  dependencies: 'Existing lock-identical dependency tree copied into each isolated checkout; workspace junctions point to that checkout. No package installation or manifest/lock change.',
  scenes, sources: [],
};
const browser = await chromium.launch({ channel: 'msedge', headless: true });
manifest.browserVersion = browser.version();
try {
  for (const [side, folder, port] of [['before', 'little-say-before', 7421], ['after', 'little-say', 7422]]) {
    const repo = path.join(root, folder), webRoot = path.join(repo, 'apps/mobile/dist');
    await checkFree(port);
    const sourceSha = git(repo, 'rev-parse', 'HEAD'), status = git(repo, 'status', '--porcelain');
    assert.equal(status, '', 'Capture requires clean committed source');
    if (side === 'before') assert.equal(sourceSha, manifest.parent);
    const stdout = fs.openSync(path.join(destination, `${side}-server.log`), 'w');
    const server = spawn(process.execPath, [path.join(repo, 'apps/server/dist/index.js')], { cwd: path.join(repo, 'apps/server'), windowsHide: true, stdio: ['ignore', stdout, stdout], env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), WEB_ROOT: webRoot, ALLOWED_ORIGINS: `http://127.0.0.1:${port}`, AAC_OPENAI_KEY: '', OPENAI_API_KEY: '', DATABASE_URL: '', PGHOST: '', PGDATABASE: '', AAC_IMAGE_GENERATION: 'false' } });
    fs.closeSync(stdout);
    const origin = `http://127.0.0.1:${port}`;
    const source = { side, sourceSha, status, port, processId: server.pid, node: process.version, serverSha256: hash(fs.readFileSync(path.join(repo, 'apps/server/dist/index.js'))), buildFiles: inventory(webRoot), captures: [] };
    try {
      let healthy = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { if ((await fetch(`${origin}/api/health`)).ok) { healthy = true; break; } } catch {}
        if (server.exitCode !== null) throw Error(`Server exited: ${server.exitCode}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(healthy); source.listenerPids = listener(port); assert(source.listenerPids.includes(server.pid));
      for (const scene of scenes) {
        const context = await browser.newContext({ viewport: scene.viewport, deviceScaleFactor: 1, colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'no-preference', serviceWorkers: 'block', ...(side === 'after' && scene.name === 'wide' ? { recordVideo: { dir: path.join(destination, 'video'), size: scene.viewport } } : {}) });
        const page = await context.newPage(), loaded = [], verifications = [], errors = [];
        await page.clock.setFixedTime(new Date(clock));
        await page.addInitScript(() => {
          window.SpeechSynthesisUtterance = class { constructor(text = '') { this.text = text; } };
          Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [{ voiceURI: 'fixture', name: 'English', lang: 'en-US', localService: true }], speak() {}, cancel() {}, addEventListener() {}, removeEventListener() {} } });
          Element.prototype.requestFullscreen = async () => {};
        });
        page.on('response', response => {
          const url = new URL(response.url());
          if (response.status() === 200 && url.origin === origin && url.pathname.startsWith('/_expo/') && url.pathname.endsWith('.js')) verifications.push((async () => {
            const bytes = await response.body(), relative = decodeURIComponent(url.pathname.slice(1)), digest = hash(bytes);
            assert.equal(digest, hash(fs.readFileSync(path.join(webRoot, relative)))); loaded.push({ url: url.pathname, sha256: digest, bytes: bytes.length });
          })().catch(error => errors.push(error.message)));
        });
        await page.goto(`${origin}/app`); await page.getByRole('heading', { name: 'Choose your languages', exact: true }).waitFor();
        await page.evaluate(async data => {
          const db = await new Promise(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
          await new Promise((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(data, 'library'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
        }, library);
        await page.reload(); await page.getByRole('button', { name: 'Water', exact: true }).waitFor(); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1000);
        const control = (await page.getByTestId('parent-control').boundingBox());
        await page.mouse.move(control.x + control.width / 2, control.y + control.height / 2); await page.mouse.down(); await page.waitForTimeout(2100); await page.mouse.up();
        if (side === 'before') await page.getByRole('heading', { name: 'Leave this board?', exact: true }).waitFor();
        else await page.getByRole('heading', { name: 'Edit board', exact: true }).waitFor();
        await page.waitForTimeout(1000);
        await Promise.all(verifications); assert.deepEqual(errors, []); assert(loaded.some(x => x.url.includes('/App-')));
        async function capture(state) {
          const filename = `${side}-${scene.name}-${state}.png`, file = path.join(destination, filename);
          await page.screenshot({ path: file, animations: 'disabled' });
          source.captures.push({ scene: scene.name, state, route: '/app', timeUtc: new Date().toISOString(), filename, sha256: hash(fs.readFileSync(file)), loadedBundles: loaded, viewport: scene.viewport });
        }
        await capture('hold-release');
        if (side === 'after') {
          if (scene.name === 'short-landscape') { await page.getByRole('button', { name: 'Edit with AI', exact: true }).scrollIntoViewIfNeeded(); await capture('scrolled-controls'); }
          await page.getByRole('button', { name: 'Return to play', exact: true }).click();
          await page.getByRole('button', { name: 'Water', exact: true }).waitFor(); await page.waitForTimeout(600); await capture('returned-idle');
        }
        const video = page.video(); await context.close();
        if (video) { const saved = path.join(destination, 'after-wide-motion.webm'); await video.saveAs(saved); source.video = { filename: 'after-wide-motion.webm', sha256: hash(fs.readFileSync(saved)) }; }
      }
      source.finalListenerPids = listener(port); assert(source.finalListenerPids.includes(server.pid));
    } finally { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
    manifest.sources.push(source);
  }
} finally { await browser.close(); }
manifest.harnessSha256 = hash(fs.readFileSync(import.meta.filename));
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ destination, browser: manifest.browserVersion, sources: manifest.sources.map(s => ({ side: s.side, sha: s.sourceSha, captures: s.captures.length })) }));
