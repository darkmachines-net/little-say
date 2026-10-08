/** @file Captures genuine isolated parent/final editors with exact fixture, running-bundle and image identities. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from './little-say-translations/node_modules/playwright/index.mjs';

const root = import.meta.dirname;
const out = path.join(root, 'translation-evidence-refresh');
fs.mkdirSync(out, { recursive: true });
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const clock = '2026-10-08T00:00:00.000Z';
const cow = { id: 'cow', label: 'Cow', speech: 'Cow', language: 'en-US', languageMode: 'board', color: 'sage', illustration: { kind: 'emoji', emoji: '🐄' } };
cow.translations = [
  { language: 'ru-RU', label: 'Корова', speech: 'корова', source: JSON.stringify(['Cow', 'Cow', 'en-US']) },
  { language: 'es-ES', label: 'Vaca', speech: 'vaca', source: JSON.stringify(['Cow', 'Cow', 'en-US']) },
];
const library = { version: 2,
  settings: { backendUrl: '', accountChoiceMade: true, voices: {}, activeBoardId: null, aiConsent: true, autoSpeech: false, boardLanguages: { farm: 'ru-RU' }, languageProfile: { languages: ['en-US', 'ru-RU', 'es-ES'], defaultLanguage: 'en-US' } },
  boards: [{ id: 'farm', title: 'Our farm words', revision: 0, createdAt: clock, updatedAt: clock, playLanguages: ['en-US', 'ru-RU', 'es-ES'], translateLabels: false, tiles: [cow,
    { id: 'sheep', label: 'Sheep', speech: 'Sheep', language: 'en-US', languageMode: 'fixed', color: 'butter', illustration: { kind: 'emoji', emoji: '🐑' } },
  ] }],
};
fs.writeFileSync(path.join(out, 'fixture.json'), JSON.stringify(library, null, 2));
function files(directory) {
  return fs.readdirSync(directory, { recursive: true }).filter(name => fs.statSync(path.join(directory, name)).isFile()).map(name => ({ path: name.replaceAll('\\', '/'), sha256: digest(fs.readFileSync(path.join(directory, name))) }));
}
async function available(port) { await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(resolve)); }); }
function listener(port) {
  return execFileSync('C:/Users/MChar/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe', ['-NoProfile', '-Command', `(Get-NetTCPConnection -State Listen -LocalPort ${port}).OwningProcess`], { encoding: 'utf8', windowsHide: true }).trim().split(/\s+/).map(Number);
}
const manifest = {
  ownerTask: '01a11cbb-ec94-715f-a3e4-7aa82a416016', issue: 'https://github.com/MChartier/little-say/issues/32',
  parent: 'fabb925cf5ee11171d5668af7c2bab44ec9fc613', ultimateMaster: 'fabb925cf5ee11171d5668af7c2bab44ec9fc613',
  fixture: { path: 'fixture.json', sha256: digest(fs.readFileSync(path.join(out, 'fixture.json'))) },
  environment: 'Windows ZBook, Playwright and installed Edge; browser execution only',
  matching: { viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'no-preference', clock,
    clockBehavior: 'Fixed starting epoch with normally advancing timers; no time-dependent fields are displayed.', serviceWorkers: 'Blocked equally on both sources to exclude stale bundles/PWA notices. No DOM or screenshot editing.',
    speech: 'Synthetic three-language device voice driver; provider endpoints mocked, no paid inference.', fullscreen: 'requestFullscreen no-op on both sources to preserve viewport.' },
  setup: 'Fresh context. Open /app, choose Continue without an account, seed identical library into existing IndexedDB state/library, reload dashboard, open Our farm words editor. Russian is the saved play language and play labels intentionally stay English. Capture board. Open first card; Before additionally chooses the existing lower Russian translation control (captured separately); After inherits Russian into its main fields. Both return to the first Position row before the matched card capture. Baseline already supports lower translation fields; this is not evidence that translation editing was entirely absent.',
  commands: ['npm.cmd run check (final clone)', 'npm.cmd run build (isolated actual-master checkout)', 'node capture-refresh.mjs'],
  dependencies: 'Separate npm ci installations from the identical current lockfile; task-local npm cache, Node 24.19.0. No dependency or lockfile changes.',
  sources: [],
};
const browser = await chromium.launch({ channel: 'msedge', headless: true });
manifest.browserVersion = browser.version();
try {
  for (const [side, folder, port] of [['before', 'little-say-before', 7631], ['after', 'little-say-translations', 7632]]) {
    const repo = path.join(root, folder), webRoot = path.join(repo, 'apps/mobile/dist');
    await available(port);
    const sourceSha = git(repo, 'rev-parse', 'HEAD'), status = git(repo, 'status', '--porcelain');
    assert.equal(status, '', 'Capture needs committed clean source');
    if (side === 'before') assert.equal(sourceSha, manifest.parent);
    const log = fs.openSync(path.join(out, `${side}-server.log`), 'w');
    const server = spawn(process.execPath, [path.join(repo, 'apps/server/dist/index.js')], { cwd: path.join(repo, 'apps/server'), windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), WEB_ROOT: webRoot, ALLOWED_ORIGINS: `http://127.0.0.1:${port}`, AAC_OPENAI_KEY: '', OPENAI_API_KEY: '', DATABASE_URL: '', PGHOST: '', PGDATABASE: '', AAC_IMAGE_GENERATION: 'false' } });
    fs.closeSync(log);
    const origin = `http://127.0.0.1:${port}`;
    const source = { side, sourceSha, status, node: process.version, port, processId: server.pid, lockSha256: digest(fs.readFileSync(path.join(repo, 'package-lock.json'))), serverSha256: digest(fs.readFileSync(path.join(repo, 'apps/server/dist/index.js'))), exportFiles: files(webRoot), captures: [] };
    try {
      let healthy = false;
      for (let i = 0; i < 100; i++) { try { if ((await fetch(`${origin}/api/health`)).ok) { healthy = true; break; } } catch {} if (server.exitCode !== null) throw Error('Capture server exited'); await new Promise(resolve => setTimeout(resolve, 100)); }
      assert(healthy); source.listenerPids = listener(port); assert(source.listenerPids.includes(server.pid));
      const context = await browser.newContext({ viewport: manifest.matching.viewport, deviceScaleFactor: 1, colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'no-preference', serviceWorkers: 'block' });
      try {
        const page = await context.newPage(), loadedBundles = [], pending = [], errors = [];
        await page.clock.install({ time: new Date(clock) });
        await page.addInitScript(() => {
          window.SpeechSynthesisUtterance = class { constructor(text = '') { this.text = text; } };
          Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => ['en-US', 'ru-RU', 'es-ES'].map(lang => ({ voiceURI: lang, name: lang, lang, localService: true })), speak(value) { value.onend?.(); }, cancel() {}, addEventListener() {}, removeEventListener() {} } });
          Element.prototype.requestFullscreen = async () => {};
        });
        await page.route('**/api/speech', route => route.fulfill({ status: 503, json: { error: 'Voice preparation failed. Try again.' } }));
        await page.route('**/api/boards/**', route => route.fulfill({ status: 503, json: { error: 'No provider used in this capture.' } }));
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => {
          const url = new URL(response.url());
          if (response.status() === 200 && url.origin === origin && url.pathname.startsWith('/_expo/') && url.pathname.endsWith('.js')) pending.push((async () => {
            const bytes = await response.body(), sha256 = digest(bytes);
            assert.equal(sha256, digest(fs.readFileSync(path.join(webRoot, decodeURIComponent(url.pathname.slice(1))))));
            loadedBundles.push({ url: url.pathname, sha256, bytes: bytes.length });
          })());
        });
        await page.goto(`${origin}/app`); await page.getByRole('button', { name: 'Continue without an account', exact: true }).click(); await page.getByRole('heading', { name: 'Choose your languages', exact: true }).waitFor();
        await page.evaluate(async data => {
          const db = await new Promise(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
          await new Promise((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(data, 'library'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
        }, library);
        await page.reload(); await page.getByRole('button', { name: 'Edit Our farm words', exact: true }).click();
        await page.getByRole('heading', { name: 'Edit board', exact: true }).waitFor(); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(600);
        async function capture(state, note) {
          await Promise.all(pending); assert(loadedBundles.some(value => value.url.includes('/App-'))); assert.deepEqual(errors, []);
          const filename = `${side}-${state}.png`, destination = path.join(out, filename);
          await page.screenshot({ path: destination, animations: 'disabled' });
          source.captures.push({ filename, state, note, timeUtc: new Date().toISOString(), route: '/app', viewport: page.viewportSize(), sha256: digest(fs.readFileSync(destination)), loadedBundles: [...loadedBundles] });
        }
        await capture('board', 'Same saved Russian play selection; fixed Sheep retains English. Play translateLabels=false does not restrict editor labels after the change.');
        await page.getByRole('button', { name: side === 'before' ? 'Edit tile Cow' : 'Edit tile Корова', exact: true }).click();
        if (side === 'before') {
          await page.getByRole('button', { name: 'Russian', exact: true }).last().click();
          await page.getByRole('textbox', { name: 'Russian spoken words', exact: true }).scrollIntoViewIfNeeded();
          await page.waitForTimeout(400); await capture('existing-translation-controls', 'Baseline-only supplemental state: lower translated text fields already exist and remain distinct from main source fields.');
        }
        await page.getByText('Position 1 of 2', { exact: true }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(500); await capture('card', 'Russian selected. Before main fields remain source English; existing lower Russian fields are present separately. After main fields and preview use Russian.');
        if (side === 'after') {
          await page.getByRole('textbox', { name: 'Russian spoken words', exact: true }).fill('коровушка');
          await page.getByRole('button', { name: 'Generate audio', exact: true }).click();
          await page.getByText('Voice preparation failed. Try again.', { exact: true }).first().waitFor();
          await page.getByRole('textbox', { name: 'Russian spoken words', exact: true }).scrollIntoViewIfNeeded();
          await capture('corrected-audio-failure', 'Current-only supplemental state: corrected Russian text remains after mocked speech failure.');
          await page.getByRole('button', { name: 'Original words', exact: true }).last().click();
          await page.getByRole('textbox', { name: 'What it says', exact: true }).fill('Moo');
          await page.getByRole('button', { name: 'Edit in Russian', exact: true }).last().click();
          await page.getByText('The original words changed.', { exact: false }).waitFor();
          await page.getByRole('textbox', { name: 'Russian spoken words', exact: true }).scrollIntoViewIfNeeded();
          await capture('stale-correction', 'Current-only supplemental state: retained corrected Russian words need review after source speech changes.');
          await page.getByRole('button', { name: 'Cancel', exact: true }).click();
          await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500);
          await capture('phone-board', 'Current-only responsive board check; not a native device capture.');
          await page.setViewportSize(manifest.matching.viewport);
          await page.route('**/api/boards/propose', route => route.fulfill({ json: { boardId: 'farm', baseRevision: 0, proposal: { title: 'Our farm words', explanation: 'A proposed Russian wording.', needsClarification: false, tiles: library.boards[0].tiles.map(tile => ({ existingId: tile.id, label: tile.label, speech: tile.speech, language: tile.language, color: tile.color, emoji: tile.illustration.emoji, translations: tile.id === 'cow' ? [{ language: 'ru-RU', label: 'Бурёнка', speech: 'бурёнка' }] : [] })) } } }));
          await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
          await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Try another Russian wording');
          await page.getByRole('button', { name: 'Send message', exact: true }).click();
          await page.getByRole('button', { name: 'Review translation replacements', exact: true }).click();
          await page.getByText('Saved: Корова / корова', { exact: true }).waitFor(); await page.waitForTimeout(400);
          await capture('ai-replacement-review', 'Current-only supplemental state: a separate explicit review protects saved words from a mocked AI proposal. No changes applied.');
          await page.getByRole('button', { name: 'Keep saved translations', exact: true }).click();
          await page.route('**/api/boards/propose', route => route.fulfill({ json: { boardId: 'farm', baseRevision: 0, proposal: { title: 'Our farm words', explanation: 'Changes the original language.', needsClarification: false, tiles: library.boards[0].tiles.map(tile => ({ existingId: tile.id, label: tile.id === 'cow' ? 'Бурёнка' : tile.label, speech: tile.id === 'cow' ? 'бурёнка' : tile.speech, language: tile.id === 'cow' ? 'ru-RU' : tile.language, color: tile.color, emoji: tile.illustration.emoji, translations: [] })) } } }));
          await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Change the original language to Russian');
          await page.getByRole('button', { name: 'Send message', exact: true }).click();
          await page.getByText('Keep the original language and edit its translation instead', { exact: false }).waitFor();
          await capture('ai-source-collision', 'Current-only recovery state: source-language collision is refused; the preceding draft and saved corrections remain intact.');

        }
      } finally { await context.close(); }
      source.finalListenerPids = listener(port); assert(source.finalListenerPids.includes(server.pid));
    } finally { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
    manifest.sources.push(source);
  }
} finally { await browser.close(); }
manifest.harnessSha256 = digest(fs.readFileSync(import.meta.filename));
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ browser: manifest.browserVersion, sources: manifest.sources.map(s => ({ side: s.side, sha: s.sourceSha, captures: s.captures.length })) }));
