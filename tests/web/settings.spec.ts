/** @file Exercises grouped Settings and About routes, durable preferences, failed saves, speech overrides, and offline deep links. */

import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { pcmToWav } from '../../apps/server/src/synthesis';
import { openExistingLibrary } from './existingLibrary';
import release from '../../native-release.json' with { type: 'json' };

async function mockVoices(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__spoken = []; w.__clips = [];
    w.SpeechSynthesisUtterance = class {
      /** Retain the requested words for deterministic browser speech assertions. */
      constructor(public text: string) {}
    };
    Object.defineProperty(w, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ voiceURI: 'test-en', name: 'English device voice', lang: 'en-US', localService: true }, { voiceURI: 'test-ru', name: 'Russian device voice', lang: 'ru-RU', localService: true }],
      speak: (utterance: any) => { w.__spoken.push({ text: utterance.text, language: utterance.lang, voice: utterance.voice?.voiceURI }); setTimeout(() => utterance.onend?.(), 10); },
      cancel() {}, addEventListener() {}, removeEventListener() {},
    } });
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { w.__clips.push(this.src); return original.call(this); };
    Element.prototype.requestFullscreen = async () => {};
  });
}

test('grouped overview links to focused pages and language defaults persist through history and reload', async ({ page }) => {
  await openExistingLibrary(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  for (const label of ['Languages', 'Voices', 'Pictures', 'Account & backup', 'Keep the app on screen', 'Privacy Policy', 'About']) await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save settings|Enable automatic AI/ })).toHaveCount(0);
  await expect(page.getByText(/Your home server|Parent settings|Private server address/)).toHaveCount(0);
  await mkdir('artifacts/screenshots/settings', { recursive: true });
  for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `artifacts/screenshots/settings/${name}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: 'Languages', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/languages$/);
  await page.getByRole('button', { name: 'More languages', exact: true }).click();
  await page.getByRole('button', { name: 'Add device language Spanish', exact: true }).click();
  await page.getByRole('button', { name: 'Default language Spanish', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/Spanish \(default\)/)).toBeVisible();
  await page.goBack();
  await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
  await page.goForward();
  await page.reload();
  await expect(page.getByText(/Spanish \(default\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Voices', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Russian', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Keep the app on screen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'In your browser', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Privacy Policy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AI processing', exact: true })).toBeVisible();
});

test('About shows the loaded web release and survives direct links and offline refresh', async ({ page, context }) => {
  await openExistingLibrary(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings\/about$/);
  await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible();
  await expect(page.getByText(release.version, { exact: true })).toBeVisible();
  await expect(page.getByText('Web', { exact: true })).toBeVisible();
  await expect(page.getByText('Build number', { exact: true })).toHaveCount(0);
  await mkdir('artifacts/screenshots/settings', { recursive: true });
  for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
    await page.setViewportSize(viewport);
    await expect(page.getByText(release.version, { exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/screenshots/settings/about-${name}.png` });
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await page.goto('/app/settings/about');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible();
  await expect(page.getByText(release.version, { exact: true })).toBeVisible();
});

test('a failed preference write keeps the old choice and can be retried on its page', async ({ page }) => {
  await openExistingLibrary(page);
  await page.goto('/app/settings/languages');
  await page.getByRole('button', { name: 'More languages', exact: true }).click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'state') { IDBObjectStore.prototype.put = original; throw new DOMException('Synthetic full storage', 'QuotaExceededError'); }
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Add device language Spanish', exact: true }).click();
  await expect(page.getByText(/Your previous preference is still in use/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add device language Spanish', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove device language Spanish', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Default language Spanish', exact: true })).toBeVisible();
});

test('device speech overrides cached AI, previews the saved voice, and stops generating that language', async ({ page }) => {
  await mockVoices(page);
  const wave = pcmToWav(Buffer.alloc(24000));
  const id = createHash('sha256').update(wave).digest('hex');
  const requested: string[] = [];
  await page.route('**/api/speech', async route => {
    const input = route.request().postDataJSON(); requested.push(input.language);
    await route.fulfill({ json: { text: input.text, language: input.language, id, cacheHit: false } });
  });
  await page.route('**/api/speech/*.wav', route => route.fulfill({ body: wave, contentType: 'audio/wav' }));
  await openExistingLibrary(page);
  await expect.poll(() => requested.includes('en-US') && requested.includes('ru-RU')).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
    return new Promise<boolean>(resolve => { const r = db.transaction('speech').objectStore('speech').get(JSON.stringify(['Cow', 'en-US'])); r.onsuccess = () => { db.close(); resolve(Boolean(r.result)); }; });
  })).toBe(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Voices', exact: true }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Device voice', exact: true }).click();
  await page.getByRole('radio', { name: 'English device voice', exact: true }).click();
  await page.getByRole('button', { name: 'Preview voice', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: 'Hello', language: 'en-US', voice: 'test-en' });
  expect(await page.evaluate(() => (window as any).__clips)).toEqual([]);
  await page.getByRole('button', { name: 'Voices', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'Play Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Cow', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.at(-1))).toEqual({ text: 'Cow', language: 'en-US', voice: 'test-en' });
  expect(await page.evaluate(() => (window as any).__clips)).toEqual([]);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => {
      const tx = db.transaction('state', 'readwrite'); const store = tx.objectStore('state'); const r = store.get('library');
      r.onsuccess = () => { const library = r.result; library.settings.activeBoardId = null; for (const board of library.boards) for (const tile of board.tiles) tile.speech += '!'; store.put(library, 'library'); };
      tx.oncomplete = () => resolve();
    }); db.close();
  });
  requested.length = 0;
  await page.goto('/app/settings/voices');
  await expect(page.getByText('English device voice', { exact: true })).toBeVisible();
  await expect.poll(() => requested.includes('ru-RU')).toBe(true);
  expect(requested).not.toContain('en-US');
});

test('direct policy and account pages work without sign-in and survive an offline refresh', async ({ page, context }) => {
  await page.goto('/app/settings/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome to Little Say', exact: true })).toHaveCount(0);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true); await page.reload();
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await page.getByRole('button', { name: 'Account & backup', exact: true }).click();
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/account\/login$/);
  await page.getByLabel('Email', { exact: true }).fill('unsent@example.test');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
});

test('AI preview ignores late synthesis after leaving, reuses its saved clip, and offers a device fallback', async ({ page }) => {
  await mockVoices(page);
  const wave = pcmToWav(Buffer.alloc(24000));
  const id = createHash('sha256').update(wave).digest('hex');
  let release!: () => void;
  let requested = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/speech', async route => {
    const input = route.request().postDataJSON();
    if (input.text !== 'Hello') return route.fulfill({ status: 503, json: { error: 'Synthetic unavailable speech' } });
    requested++; await gate;
    await route.fulfill({ json: { ...input, id, cacheHit: false } });
  });
  await page.route('**/api/speech/*.wav', route => route.fulfill({ body: wave, contentType: 'audio/wav' }));
  await openExistingLibrary(page);
  await page.goto('/app/settings/voices/en-US');
  await page.getByRole('button', { name: 'Preview voice', exact: true }).click();
  await expect.poll(() => requested).toBe(1);
  await page.getByRole('button', { name: 'Voices', exact: true }).click();
  release();
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
    return new Promise<boolean>(resolve => { const r = db.transaction('speech').objectStore('speech').get(JSON.stringify(['Hello', 'en-US'])); r.onsuccess = () => { db.close(); resolve(Boolean(r.result)); }; });
  })).toBe(true);
  expect(await page.evaluate(() => (window as any).__clips)).toEqual([]);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Preview voice', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__clips.length)).toBe(1);
  expect(requested).toBe(1);
  await expect(page.getByRole('button', { name: 'Preview voice', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Preview words', exact: true }).fill('Fallback sample');
  await page.getByRole('button', { name: 'Preview voice', exact: true }).click();
  await expect(page.getByText('AI speech is unavailable right now. Previewing the device fallback.', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.at(-1)?.text)).toBe('Fallback sample');
});
