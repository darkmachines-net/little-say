/** @file Verifies shipped AI audio with APIs unavailable, on-demand loading, device fallback, mutation gates, account links, and data isolation. */

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import audio from '../../apps/mobile/src/website/audio/manifest.json' with { type: 'json' };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const browser = window as any;
    browser.__spoken = [];
    browser.__speechStops = 0;
    browser.__audioPlayed = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      browser.__audioPlayed.push({ duration: this.buffer!.duration, offset: args[1] ?? 0 });
      return start.apply(this, args);
    };
    browser.SpeechSynthesisUtterance = class {
      /** Retain requested words so the test can observe the real player-to-speech wiring. */
      constructor(public text: string) {}
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ voiceURI: 'trial-en', name: 'English', lang: 'en-US', localService: true }],
      speak: (utterance: any) => { browser.__spoken.push({ text: utterance.text, language: utterance.lang }); setTimeout(() => utterance.onend?.(), 10); },
      cancel: () => { browser.__speechStops++; }, addEventListener() {}, removeEventListener() {},
    } });
  });
});

for (const width of [1280, 390]) {
  test(`guests play all bundled AI words with APIs unavailable and no storage at ${width}px`, async ({ page }) => {
    const apiRequests: string[] = [];
    const audioRequests: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/starter-audio/')) audioRequests.push(new URL(request.url()).pathname); });
    await page.route('**/api/**', route => route.abort());
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/app/try/');
    await expect(page.getByRole('heading', { name: 'Try a starter board' })).toBeVisible();
    await expect(page.getByTestId('library-board')).toHaveCount(3);
    expect(await page.getByTestId('starter-trial').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/screenshots/trial/boards-${width}.png` });
    expect(audioRequests).toEqual([]);
    const played: string[] = [];
    for (const [title, words] of [
      ['Farm Animals', ['Horse', 'Pig', 'Goat', 'Chicken', 'Sheep', 'Cow']],
      ['Rainbow', ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple']],
      ['Shapes', ['Circle', 'Triangle', 'Square', 'Rectangle', 'Diamond', 'Heart']],
    ] as const) {
      await page.getByRole('button', { name: `Play ${title}`, exact: true }).click();
      await expect(page.getByTestId('play-board')).toBeVisible();
      for (const word of words) {
        await page.getByRole('button', { name: word, exact: true }).click();
        played.push(`/starter-audio/${audio.clips.find(clip => clip.text === word && clip.language === 'en-US')!.id}.wav`);
        await expect.poll(() => page.evaluate(() => (window as any).__audioPlayed.length)).toBe(played.length);
        await expect(page.getByTestId('tile-playing')).toHaveCount(0);
      }
      const stops = await page.evaluate(() => (window as any).__speechStops);
      await page.getByRole('button', { name: 'Back to starter boards', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Try a starter board' })).toBeVisible();
      expect(await page.evaluate(() => (window as any).__speechStops)).toBeGreaterThan(stops);
    }
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    expect(apiRequests).toEqual([]);
    expect(audioRequests).toEqual(played);
    expect(await page.evaluate(() => (window as any).__spoken)).toEqual([]);
    expect(await page.evaluate(() => (window as any).__audioPlayed.every((clip: any) => clip.duration > 0.1 && clip.offset === 0))).toBe(true);
    await page.reload();
    await expect(page.getByTestId('library-board')).toHaveCount(3);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  });
}

test('every creation and board-management entry prompts for a free account and can be dismissed', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.goto('/app/try');
  const actions = ['New board', ...['Farm Animals', 'Rainbow', 'Shapes'].flatMap(title => [`Edit ${title}`, `More options for ${title}`, `Add ${title} to favorites`])];
  for (const action of actions) {
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Make it yours', exact: true })).toBeVisible();
    await expect(page.getByText('Create a free account to create, edit, and save your own boards.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create a free account', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await page.getByRole('button', { name: 'Keep trying', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Make it yours', exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Make it yours', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make it yours', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/screenshots/trial/account-prompt.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Close Make it yours', exact: true }).click();
  await expect(page.getByTestId('library-board')).toHaveCount(3);
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  expect(apiRequests).toEqual([]);
});

test('falls back to device speech when a bundled clip fails, while other bundled words still play', async ({ page }) => {
  const id = audio.clips.find(clip => clip.text === 'Horse')!.id;
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await page.route(`**/starter-audio/${id}.wav`, route => route.fulfill({ status: 404 }));
  await page.goto('/app/try');
  await page.getByRole('button', { name: 'Play Farm Animals', exact: true }).click();
  await page.getByRole('button', { name: 'Horse', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken)).toEqual([{ text: 'Horse', language: 'en-US' }]);
  await expect(page.getByTestId('tile-playing')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pig', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__audioPlayed.length)).toBe(1);
  await expect(page.getByTestId('tile-playing')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual([{ text: 'Horse', language: 'en-US' }]);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});

test('invalid audio bytes also fall back to device speech', async ({ page }) => {
  await page.route('**/starter-audio/*.wav', route => route.fulfill({ body: 'invalid audio', contentType: 'audio/wav' }));
  await page.goto('/app/try');
  await page.getByRole('button', { name: 'Play Shapes', exact: true }).click();
  await page.getByRole('button', { name: 'Heart', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken)).toEqual([{ text: 'Heart', language: 'en-US' }]);
});

test('account links preserve browser Back and registration creates independent editable starters', async ({ page }) => {
  await page.route('**/api/speech', route => route.fulfill({ status: 503, json: { error: 'Use device speech' } }));
  await page.goto('/app/try');
  await page.getByRole('button', { name: 'Edit Farm Animals', exact: true }).click();
  await page.getByRole('button', { name: 'Create a free account', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/account\/register$/);
  await expect(page.getByRole('heading', { name: 'Create an account', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Confirm password', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Try a starter board' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/account\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('button', { name: 'Create a free account', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('my starter board passphrase');
  await page.getByLabel('Confirm password', { exact: true }).fill('my starter board passphrase');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByTestId('library-board')).toHaveCount(3);
  await page.getByRole('button', { name: 'Edit Farm Animals', exact: true }).click();
  await page.getByRole('textbox', { name: 'Board title', exact: true }).fill('My farm');
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play My farm', exact: true })).toBeVisible();
  await page.goto('/app/try');
  await expect(page.getByRole('button', { name: 'Play Farm Animals', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play My farm', exact: true })).toHaveCount(0);
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Play My farm', exact: true })).toBeVisible();
});

test('trying boards leaves an existing device library untouched', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const request = indexedDB.open('little-say', 3);
    request.onupgradeneeded = () => { for (const store of ['state', 'photos', 'speech', 'pictures']) request.result.createObjectStore(store); };
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = database.transaction('state', 'readwrite');
    transaction.objectStore('state').put({ privateLibrary: 'unchanged' }, 'library');
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    database.close();
  });
  await page.getByRole('link', { name: 'Try Little Say on the web', exact: true }).click();
  await page.getByRole('button', { name: 'Play Shapes', exact: true }).click();
  await page.getByRole('button', { name: 'Heart', exact: true }).click();
  await page.getByRole('button', { name: 'Back to starter boards', exact: true }).click();
  expect(await page.evaluate(async () => {
    const request = indexedDB.open('little-say', 3);
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const read = database.transaction('state').objectStore('state').get('library');
    const saved = await new Promise(resolve => { read.onsuccess = () => resolve(read.result); });
    database.close(); return saved;
  })).toEqual({ privateLibrary: 'unchanged' });
});
