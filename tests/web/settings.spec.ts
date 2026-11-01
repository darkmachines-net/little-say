/** @file Exercises grouped preferences/account Settings without routine sync status, the three-language cap and replacements, About, media migration, offline links, and dashboard/account-entry navigation. */

import { test, expect, type Page } from '@playwright/test';
import { openBoardLanguages } from './boardEditor';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { pcmToWav } from '../../apps/server/src/synthesis';
import { addUserLanguage, openExistingLibrary, removeUserLanguage } from './existingLibrary';
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
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await expect(page.getByTestId('backup-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Backup details', exact: true })).toHaveCount(0);
  for (const label of ['Languages', 'Sign-in methods', 'Sign out', 'Delete account', 'Keep the app on screen', 'Privacy Policy', 'About']) await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  for (const label of ['Voices', 'Pictures', 'Account & backup']) await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
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
  await addUserLanguage(page, 'Spanish');
  await page.getByRole('combobox', { name: 'Default language', exact: true }).selectOption('es-ES');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/Spanish \(default\)/)).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: /^(New board|Resume draft)$/ })).toBeVisible();
  await page.goForward();
  await page.reload();
  await expect(page.getByText(/Spanish \(default\)/)).toBeVisible();
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
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'state') { IDBObjectStore.prototype.put = original; throw new DOMException('Synthetic full storage', 'QuotaExceededError'); }
      return original.apply(this, args);
    };
  });
  await addUserLanguage(page, 'Spanish');
  await expect(page.getByText(/Your previous preference is still in use/)).toBeVisible();
  await expect(page.getByText('Spanish', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Add a language', exact: true })).toBeEditable();
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Default language', exact: true }).getByRole('option', { name: 'Spanish', exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Default language', exact: true }).getByRole('option', { name: 'Spanish', exact: true })).toHaveCount(1);
});

test('simple-list controls support keyboard search, explicit editing, language limits, and a single default', async ({ page }) => {
  await openExistingLibrary(page, { languageProfile: { languages: ['en-US', 'es-ES'], defaultLanguage: 'en-US' } });
  await page.goto('/app/settings/languages');
  const search = page.getByRole('textbox', { name: 'Add a language', exact: true });
  const defaultLanguage = page.getByRole('combobox', { name: 'Default language', exact: true });
  await expect(page.getByRole('button', { name: /Remove language|Make default/ })).toHaveCount(0);
  await expect(page.getByText('United States', { exact: true })).toBeVisible();
  await search.fill('Spain');
  await expect(page.getByText('This language is already selected.', { exact: true })).toBeVisible();
  await search.fill('Germany');
  await search.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Add language German', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await expect(page.getByRole('button', { name: 'Add language German', exact: true })).toHaveCount(0);
  await search.fill('ger');
  await search.press('Enter');
  await expect(page.getByText('3 of 3', { exact: true })).toBeVisible();
  await expect(search).toHaveValue('');
  await expect(search).not.toBeEditable();
  await expect(page.getByText('Remove a language to add another.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit languages', exact: true }).click();
  await page.getByRole('button', { name: 'Remove language German', exact: true }).click();
  await expect(search).toBeEditable();
  await addUserLanguage(page, 'es-mx', 'es-MX');
  await expect(search).not.toBeEditable();
  await expect(page.getByText('3 of 3', { exact: true })).toBeVisible();
  await defaultLanguage.selectOption('es-MX');
  await expect(defaultLanguage).toHaveValue('es-MX');
  await page.getByRole('button', { name: /^Remove language (Mexican Spanish|Spanish \(Mexico\))$/ }).click();
  await expect(defaultLanguage).toHaveValue('en-US');
  await expect(search).toBeEditable();
  await page.getByRole('button', { name: 'Done editing languages', exact: true }).click();
  await expect(page.getByRole('button', { name: /Remove language/ })).toHaveCount(0);
  await search.fill('Japanese');
  await defaultLanguage.focus();
  await expect(page.getByRole('button', { name: 'Add language Japanese', exact: true })).toHaveCount(0);
  await search.click();
  await page.getByRole('heading', { name: 'Languages', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add language Japanese', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(defaultLanguage).toHaveValue('en-US');
  await expect(page.getByText('2 of 3', { exact: true })).toBeVisible();
});

test('boards inherit user languages and only offer a persistent play subset with a route back to Settings', async ({ page }) => {
  await openExistingLibrary(page, { voiceSources: { 'en-US': 'device', 'es-ES': 'device', 'fr-FR': 'device', 'de-DE': 'device' } });
  await page.goto('/app/settings/languages');
  await addUserLanguage(page, 'span', 'Spanish');
  await mkdir('artifacts/screenshots/languages', { recursive: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1180, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('textbox', { name: 'Add a language', exact: true }).fill('ger');
    await expect(page.getByRole('button', { name: 'Add language German', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add language Spanish', exact: true })).toHaveCount(0);
    await page.screenshot({ path: `artifacts/screenshots/languages/picker-${viewport.width}.png` });
    await page.getByRole('textbox', { name: 'Add a language', exact: true }).press('Escape');
    await expect(page.getByRole('textbox', { name: 'Add a language', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await addUserLanguage(page, 'French');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await openBoardLanguages(page);
  for (const name of ['English', 'Spanish', 'French']) await expect(page.getByRole('checkbox', { name: `Play language ${name}`, exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Add language', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Add a language', exact: true })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Limit languages for this board', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Prepare translations|Switch labels|Make all cards switchable/ })).toHaveCount(0);
  await expect(page.getByText('Audio', { exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Play language English', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Play language French', exact: true }).click();
  await page.screenshot({ path: 'artifacts/screenshots/languages/board-subset.png' });
  await page.getByRole('checkbox', { name: 'Play language Spanish', exact: true }).click();
  await expect(page.getByText('Keep at least one language for play.', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Play language Spanish', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Manage your languages in Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/languages$/);
  await removeUserLanguage(page, 'French');
  await addUserLanguage(page, 'German');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Back to board', exact: true }).click();
  await openBoardLanguages(page);
  await expect(page.getByRole('checkbox', { name: 'Play language Spanish', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Play language German', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Close Board languages', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await openBoardLanguages(page);
  await expect(page.getByRole('checkbox', { name: 'Play language Spanish', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Play language German', exact: true })).not.toBeChecked();
  for (const name of ['English', 'German']) await page.getByRole('checkbox', { name: `Play language ${name}`, exact: true }).click();
  for (const name of ['English', 'Spanish', 'German']) await expect(page.getByRole('checkbox', { name: `Play language ${name}`, exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Close Board languages', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'Edit My little words', exact: true }).click();
  await openBoardLanguages(page);
  for (const name of ['English', 'Spanish', 'German']) await expect(page.getByRole('checkbox', { name: `Play language ${name}`, exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Manage your languages in Settings', exact: true }).click();
  await removeUserLanguage(page, 'German');
  await addUserLanguage(page, 'Italian');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Back to board', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await openBoardLanguages(page);
  await expect(page.getByRole('checkbox', { name: 'Play language Italian', exact: true })).toBeChecked();
});

test('retired media links show the overview and saved overrides return to default AI speech', async ({ page }) => {
  await mockVoices(page);
  const wave = pcmToWav(Buffer.alloc(24000));
  const id = createHash('sha256').update(wave).digest('hex');
  const requested: string[] = [];
  await page.route('**/api/speech', async route => {
    const input = route.request().postDataJSON(); requested.push(input.language);
    await route.fulfill({ json: { text: input.text, language: input.language, id, cacheHit: false } });
  });
  await page.route('**/api/speech/*.wav', route => route.fulfill({ body: wave, contentType: 'audio/wav' }));
  await openExistingLibrary(page, { autoSpeech: false, voiceSources: { 'en-US': 'device' }, voices: { 'en-US': 'missing-voice' }, pictureDefaults: { mode: 'emoji', style: 'line', consistent: true } });
  await expect.poll(() => requested.includes('en-US') && requested.includes('ru-RU')).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
    return new Promise<boolean>(resolve => { const r = db.transaction('speech').objectStore('speech').get(JSON.stringify(['Cow', 'en-US'])); r.onsuccess = () => { db.close(); resolve(Boolean(r.result)); }; });
  })).toBe(true);
  for (const path of ['voices', 'voices/en-US', 'pictures']) {
    await page.goto('/app/settings/' + path);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    for (const label of ['Voices', 'Pictures']) await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  }
  const settings = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
    return new Promise<any>(resolve => { const r = db.transaction('state').objectStore('state').get('library'); r.onsuccess = () => { db.close(); resolve(r.result.settings); }; });
  });
  expect(settings.voiceSources).toEqual({}); expect(settings.voices).toEqual({});
  expect(settings.autoSpeech).toBe(true); expect(settings.pictureDefaults).toBeUndefined();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'Play Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Cow', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__clips.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual([]);
});

test('settings deep links require sign-in, then remain available offline with the saved account', async ({ page, context }) => {
  await page.goto('/app/settings/privacy');
  await expect(page.getByRole('heading', { name: 'Little Say: Learn to Talk!', exact: true })).toBeVisible();
  await openExistingLibrary(page);
  await page.goto('/app/settings/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true); await page.reload();
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('legacy account links open standalone forms with refresh and browser history', async ({ page }) => {
  await page.goto('/app/settings/account/login');
  await expect(page).toHaveURL(/\/app\/account\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/account\/reset$/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/account\/register$/);
  await page.reload();
  await expect(page.getByLabel('Confirm password', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Little Say: Learn to Talk!', exact: true })).toBeVisible();
});
