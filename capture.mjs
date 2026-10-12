/** @file Builds real baseline/final settings components in an isolated browser fixture and retains raw screenshots with provenance. */

import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidence = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.argv[2]);
const dependencies = resolve(process.argv[3] || source, 'node_modules');
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const base = git('rev-parse', 'origin/master');
const head = git('rev-parse', 'HEAD');
const captures = [];
const pageErrors = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname;
    if (!/^\/(before|after)\/(index\.html|bundle\.js)$/.test(name)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', name.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(await readFile(join(evidence, 'builds', name)));
  } catch { res.writeHead(500); res.end(); }
});
try {
  await mkdir(join(evidence, 'screenshots'), { recursive: true });
  const rnWeb = join(dependencies, 'react-native-web/dist/index.js');
  const version = JSON.parse(await readFile(join(source, 'apps/mobile/app.json'), 'utf8')).expo.version;
  for (const mode of ['before', 'after']) {
    await mkdir(join(evidence, 'builds', mode), { recursive: true });
    await build({
      entryPoints: [join(evidence, 'fixture.tsx')], bundle: true, minify: true, sourcemap: false,
      outfile: join(evidence, 'builds', mode, 'bundle.js'), platform: 'browser', jsx: 'automatic',
      resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
      nodePaths: [dependencies], define: { __DEV__: 'false', 'process.env.NODE_ENV': '"production"' },
      alias: { '@little-say/core': join(source, 'packages/core/src/index.ts'), 'react-native-svg': join(dirname(dependencies), 'apps/mobile/node_modules/react-native-svg/lib/module/ReactNativeSVG.web.js') },
      plugins: [{ name: 'disclosed-native-fixtures', setup(builder) {
        builder.onResolve({ filter: /^@subject\/ParentSettings$/ }, () => ({ path: join(source, 'apps/mobile/src/ui/ParentSettings.tsx') }));
        builder.onResolve({ filter: /^\.\/AppUpdateSettings$/ }, () => ({ path: join(source, 'apps/mobile/src/ui/AppUpdateSettings.tsx') }));
        builder.onResolve({ filter: /^(react-native|expo-updates|expo-constants)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
        builder.onResolve({ filter: /\/data\/storage$/ }, () => ({ path: 'storage', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
          const sources = {
            'react-native': `export * from ${JSON.stringify(rnWeb)}; import { Platform as WebPlatform } from ${JSON.stringify(rnWeb)}; export const Platform = { ...WebPlatform, OS: new URLSearchParams(location.search).get('platform') || 'android' };`,
            'expo-constants': `export default {expoConfig: {version: ${JSON.stringify(version)}, extra: {}}};`,
            storage: 'export async function requestPersistence() { return false; }',
            'expo-updates': `
              const scenario = new URLSearchParams(location.search).get('scenario');
              const event = name => window.__otaEvidence.events.push(name);
              export const isEnabled = scenario !== 'disabled';
              export async function checkForUpdateAsync() {
                event('check');
                if (scenario === 'checking') return new Promise(() => {});
                if (scenario === 'error') throw new Error('Simulated offline check');
                return { isAvailable: scenario !== 'up-to-date', isRollBackToEmbedded: false };
              }
              export async function fetchUpdateAsync() {
                event('fetch');
                if (scenario === 'downloading') return new Promise(() => {});
                return { isNew: true, isRollBackToEmbedded: false };
              }
              export async function reloadAsync() { event('reload-requested'); return new Promise(() => {}); }
            `,
          };
          return { contents: sources[args.path], loader: 'js', resolveDir: source };
        });
        if (mode === 'before') builder.onLoad({ filter: /[\\/]ParentSettings\.tsx$/ }, args => ({
          contents: git('show', `${base}:apps/mobile/src/ui/ParentSettings.tsx`), loader: 'tsx', resolveDir: dirname(args.path),
        }));
      } }],
    });
    await writeFile(join(evidence, 'builds', mode, 'index.html'), '<!-- Isolated settings evidence; real components, browser rendering, mocked OTA and persistence. -->\n<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Little Say OTA review fixture</title><style>html,body,#root{margin:0;width:100%;height:100%;background:#f7f5ef}</style></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  }
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const spec of [
    { name: 'before-android-phone', mode: 'before', scenario: 'idle', platform: 'android', width: 390, height: 844 },
    ...['idle', 'checking', 'downloading', 'up-to-date', 'error', 'restart', 'disabled'].map(scenario => ({ name: `after-android-phone-${scenario}`, mode: 'after', scenario, platform: 'android', width: 390, height: 844 })),
    { name: 'after-ios-tablet-idle', mode: 'after', scenario: 'idle', platform: 'ios', width: 820, height: 1180 },
  ]) {
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push({ capture: spec.name, message: error.message }));
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(`${origin}/${spec.mode}/index.html?scenario=${spec.scenario}&platform=${spec.platform}`);
    await expect(page.getByRole('heading', { name: 'Parent settings', exact: true })).toBeVisible();
    const heading = spec.mode === 'after' ? page.getByRole('heading', { name: 'App updates', exact: true }) : page.getByText('Lock the screen', { exact: true });
    await heading.scrollIntoViewIfNeeded();
    await heading.evaluate(element => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowY)) {
          parent.scrollTop += element.getBoundingClientRect().top - parent.getBoundingClientRect().top - 16;
          break;
        }
      }
    });
    if (spec.mode === 'after') {
      const check = page.getByRole('button', { name: 'Check for updates', exact: true });
      if (spec.scenario === 'disabled') await expect(check).toBeDisabled();
      else if (spec.scenario !== 'idle') {
        await check.click();
        const expected = { checking: 'Checking for updates…', downloading: 'Downloading update…', 'up-to-date': 'Little Say is up to date.', error: 'Could not check for updates. Check your internet connection and try again.', restart: 'Restarting to install…' }[spec.scenario];
        await expect(page.getByText(expected, { exact: true }).first()).toBeVisible();
      }
    } else await expect(page.getByText('App updates', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: join(evidence, 'screenshots', `${spec.name}.png`), animations: 'disabled' });
    const trace = await page.evaluate(() => window.__otaEvidence);
    if (spec.scenario === 'restart') {
      expect(trace.events).toEqual(['check', 'fetch', 'save', 'reload-requested']);
      expect(trace.saved.backendUrl).toBe('https://example.invalid');
    }
    captures.push({ ...spec, file: `screenshots/${spec.name}.png`, sha256: sha256(await readFile(join(evidence, 'screenshots', `${spec.name}.png`))), trace });
    await context.close();
  }
  expect(pageErrors).toEqual([]);
  const sourcePaths = ['apps/mobile/src/ui/ParentSettings.tsx', 'apps/mobile/src/ui/AppUpdateSettings.tsx', 'apps/mobile/src/ui/AppUpdateSettings.web.tsx', 'apps/mobile/src/ui/AppUpdateSettings.test.ts', 'docs/releases.md'];
  const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, sha256(await readFile(join(source, path)))])));
  const buildHashes = Object.fromEntries(await Promise.all(['before', 'after'].map(async mode => [mode, sha256(await readFile(join(evidence, 'builds', mode, 'bundle.js')))])));
  await writeFile(join(evidence, 'manifest.json'), JSON.stringify({
    capturedAt: new Date().toISOString(), baseCommit: base, sourceCommit: head, sourceHashes, buildHashes,
    browser: browser.version(), renderer: 'Microsoft Edge / React Native Web', screenshotsEdited: false,
    limitations: ['Browser-rendered real ParentSettings and AppUpdateSettings; not Android/iOS runtime screenshots.', 'Platform.OS and expo-updates are fixture adapters. OTA results are simulated and no real update is fetched.', 'Account data, native storage, and restart are simulated. Reload is recorded, not executed.'],
    pageErrors, captures,
  }, null, 2) + '\n');
  console.log(`Captured ${captures.length} screenshots; no page errors. Source: ${head}`);
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
