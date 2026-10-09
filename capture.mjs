/** @file Captures genuine isolated exports with identical synthetic config, viewport, clock, and navigation. */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const require = createRequire(resolve('little-say/package.json'));
const { chromium, expect } = require('@playwright/test');
const hash = data => createHash('sha256').update(data).digest('hex');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const record = { capturedAt: new Date().toISOString(), browser: browser.version(), environment: 'Windows MCHARTIER_ZBOOK; Playwright 1.63.0; installed Chrome; headless', fixture: 'synthetic-public-provider-config; fresh IndexedDB; no real accounts; 2026-10-09T06:00:00Z clock', normalization: 'Service workers blocked identically; no UI hiding, cropping, redaction or image editing; animations disabled only during screenshots.', sources: {}, captures: [], servedScripts: [] };
try {
  for (const [side, folder, port] of [['before', 'before', 4277], ['after', 'little-say', 4276]]) {
    record.sources[side] = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: folder, encoding: 'utf8' }).trim(), status: execFileSync('git', ['status', '--porcelain'], { cwd: folder, encoding: 'utf8' }).trim(), files: [] };
    for (const f of execFileSync('git', ['ls-files'], { cwd: folder, encoding: 'utf8' }).trim().split('\n')) record.sources[side].files.push({ path: f, sha256: hash(readFileSync(resolve(folder, f))) });
    for (const [size, width, height] of [['phone', 390, 844], ['tablet', 820, 1180]]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' });
      let finish;
      await context.addInitScript(() => { const OriginalDate = Date; globalThis.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-10-09T06:00:00Z'])); } static now() { return OriginalDate.parse('2026-10-09T06:00:00Z'); } }; });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/account/config') return route.fulfill({ json: { projectId: 'demo-preparation', apiKey: 'synthetic-public-key', appId: 'synthetic-app', authDomain: 'example.test', providers: ['password', 'google.com', 'apple.com'] } });
        if (url.hostname === 'identitytoolkit.googleapis.com') { await new Promise(resolve => { finish = resolve; }); return route.fulfill({ status: 400, json: { error: { message: 'INVALID_LOGIN_CREDENTIALS' } } }); }
        if (url.hostname !== '127.0.0.1') return route.abort();
        if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { error: 'Synthetic offline service' } });
        return route.continue();
      });
      const page = await context.newPage();
      page.on('response', async response => { if (response.url().includes('/_expo/static/js/')) { const bytes = await response.body(); record.servedScripts.push({ side, size, url: response.url(), sha256: hash(bytes) }); } });
      const capture = async state => { const file = `${side}-${size}-${state}.png`; await page.screenshot({ path: resolve('evidence', file), animations: 'disabled' }); record.captures.push({ side, size, width, height, state, file, sha256: hash(readFileSync(resolve('evidence', file))) }); };
      await page.goto(`http://127.0.0.1:${port}/app`);
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      const apple = page.getByRole('button', { name: 'Continue with Apple', exact: true });
      await expect(apple).toBeEnabled(); await apple.scrollIntoViewIfNeeded(); await page.evaluate(() => document.fonts.ready);
      await capture('login');
      await page.getByLabel('Email', { exact: true }).fill('synthetic@example.test');
      await page.getByLabel('Password', { exact: true }).fill('synthetic password');
      await page.getByRole('button', { name: 'Sign in & sync this device', exact: true }).click();
      await expect(apple).toBeDisabled(); await expect.poll(() => Boolean(finish)).toBe(true);
      await apple.scrollIntoViewIfNeeded(); await capture('login-busy');
      finish(); await expect(apple).toBeEnabled();
      await page.getByRole('alert').scrollIntoViewIfNeeded(); await capture('login-retry');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Continue without an account', exact: true }).click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('button', { name: 'Start without starter boards', exact: true }).click();
      await page.getByRole('button', { name: 'Parent settings', exact: true }).click();
      await page.getByRole('button', { name: 'OpenAI data policy', exact: true }).scrollIntoViewIfNeeded();
      await capture('privacy-entry');
      if (side === 'after') {
        await page.getByRole('button', { name: 'Little Say privacy information', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Little Say privacy information', exact: true })).toBeVisible();
        await capture('privacy-content');
      }
      await context.close();
    }
  }
} finally { await browser.close(); writeFileSync('evidence/capture-record.json', JSON.stringify(record, null, 2) + '\n'); }
