/** @file Exercises optional account consent, full photo/picture/audio restore, offline edits, conflicts, and local-preserving sign-out in real browsers. */

import { test, expect, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { starterLibrary } from '../fixtures/library';
import { pcmToWav } from '../../apps/server/src/synthesis';

const password = 'a test family passphrase';

test('launch choices, form back/cancel and settings navigation preserve guest state across relaunch', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Welcome to Little Say', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('cancelled@example.test');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Password', { exact: true }).fill('never submitted');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Continue without an account', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start without starter boards', exact: true }).click();
  const before = await readLibrary(page);
  expect(before.settings.accountChoiceMade).toBe(true);
  expect(before.settings.aiConsent).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Parent settings', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
  await page.getByLabel('Private server address', { exact: true }).fill('https://unsaved.example');
  await page.getByRole('button', { name: 'Log in or create an account', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Private server address', { exact: true })).toHaveValue('https://unsaved.example');
  await page.getByRole('button', { name: 'Close Parent settings', exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true); await page.reload();
  await expect(page.getByText('No boards yet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Parent settings', exact: true }).click();
  await page.getByRole('button', { name: 'Log in or create an account', exact: true }).click();
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Continue without an account', exact: true }).click();
  expect(await readLibrary(page)).toEqual(before);
});

test('an existing guest library survives the new launch choice and failed choice persistence', async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Welcome to Little Say', exact: true })).toBeVisible();
  const library = starterLibrary(); library.settings.autoSpeech = false;
  await page.evaluate(async library => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(library, 'library'); tx.oncomplete = () => resolve(); }); db.close();
  }, library);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome to Little Say', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { IDBObjectStore.prototype.put = original; throw new DOMException('Synthetic full storage', 'QuotaExceededError'); };
  });
  await page.getByRole('button', { name: 'Continue without an account', exact: true }).click();
  await expect(page.getByText('Your choice could not be saved. Check device storage and try again.', { exact: true })).toBeVisible();
  expect((await readLibrary(page)).boards).toEqual(library.boards);
  await page.getByRole('button', { name: 'Continue without an account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play Farmyard friends', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Play Farmyard friends', exact: true })).toBeVisible();
  expect((await readLibrary(page)).boards).toEqual(library.boards);
});
async function readLibrary(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
    const library = await new Promise<any>(resolve => { const r = db.transaction('state').objectStore('state').get('library'); r.onsuccess = () => resolve(r.result); }); db.close(); return library;
  });
}
async function signIn(page: Page, username: string) {
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in & sync this device', exact: true }).click();
}
async function changeTitle(page: Page, title: string) {
  await page.evaluate(async title => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state'), request = store.get('library');
      request.onsuccess = () => { const library = request.result; library.boards[0].title = title; library.boards[0].revision++; library.boards[0].updatedAt = new Date().toISOString(); store.put(library, 'library'); };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  }, title);
  await page.reload();
}

test('accounts restore all asset types to a fresh device and merge offline conflicts without losing boards', async ({ page, browser }) => {
  test.setTimeout(120000);
  const username = `family_${randomUUID().slice(0, 8)}@example.test`;
  const second = await browser.newContext(); const other = await second.newPage();
  try {
    await page.goto('/app');
  await page.getByRole('button', { name: 'Continue without an account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
    // Seed a device with already-owned files. Everything after this uses the live account API.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=';
    const pictureId = createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex');
    const audio = pcmToWav(Buffer.alloc(2400)); const audioId = createHash('sha256').update(audio).digest('hex');
    const library = starterLibrary(); library.settings.accountChoiceMade = true; library.settings.autoSpeech = false; library.settings.aiConsent = false;
    library.boards = [library.boards[0]];
    library.boards[0].tiles[0].illustration = { kind: 'photo', assetId: 'family-photo', zoom: 1.4, x: 0.2, y: -0.3 };
    library.boards[0].tiles[1].illustration = { kind: 'generated', assetId: pictureId, style: 'color', description: 'Test picture', model: 'fixture' };
    const speechKey = JSON.stringify([library.boards[0].tiles[0].speech, library.boards[0].tiles[0].language]);
    await page.evaluate(async ({ library, png, pictureId, audio, audioId, speechKey }) => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
      const image = new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['state', 'photos', 'pictures', 'speech'], 'readwrite');
        tx.objectStore('state').put(library, 'library'); tx.objectStore('photos').put(image, 'family-photo'); tx.objectStore('pictures').put(image, pictureId);
        tx.objectStore('speech').put({ id: audioId, blob: new Blob([Uint8Array.from(audio)], { type: 'audio/wav' }) }, speechKey);
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      }); db.close();
    }, { library, png, pictureId, audio: [...audio], audioId, speechKey });
    await page.reload();
    await page.getByRole('button', { name: 'Parent settings', exact: true }).click();
    await page.getByRole('button', { name: /^(Log in or create an account|Open account & backup)$/ }).click();
    await page.getByRole('button', { name: 'Create an account', exact: true }).click();
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill(password);
    await expect(page.getByText(/Continuing enables backup/)).toBeVisible();
    await page.getByRole('button', { name: 'Create account & enable backup', exact: true }).click();
    await expect(page.getByText('Verify your email before syncing. Your boards still work offline.', { exact: true })).toBeVisible();
    const codes = await (await page.request.get('http://127.0.0.1:9099/emulator/v1/projects/demo-little-say/oobCodes')).json();
    const verification = codes.oobCodes.find((value: { email: string; requestType: string }) => value.email === username && value.requestType === 'VERIFY_EMAIL');
    expect(verification).toBeTruthy();
    const verified = await page.request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key', { data: { oobCode: verification.oobCode } });
    expect(verified.ok()).toBe(true);
    await page.getByLabel('Password for verification', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Check email verification', exact: true }).click();
    await expect(page.getByText('All boards and assets are synced.', { exact: true })).toBeVisible();
    await expect.poll(async () => (await readLibrary(page)).sync.snapshot.assets.length).toBe(3);
    expect(await page.evaluate(() => localStorage.getItem('little-say-firebase-account'))).not.toContain('token');
    await other.goto('/app');
    await signIn(other, username);
    await expect(other.getByText('All boards and assets are synced.', { exact: true })).toBeVisible();
    const restored = await readLibrary(other);
    expect(restored.boards).toEqual(library.boards); expect(restored.setup).toBeUndefined();
    expect(restored.settings.aiConsent).toBe(false);
    const bytes = await other.evaluate(async ({ speechKey, pictureId }) => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
      const read = (store: string, key: string) => new Promise<any>(resolve => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => resolve(r.result); });
      const photo = await read('photos', 'family-photo'), picture = await read('pictures', pictureId), speech = await read('speech', speechKey); db.close();
      return { photo: [...new Uint8Array(await photo.arrayBuffer())], picture: [...new Uint8Array(await picture.arrayBuffer())], speech: [...new Uint8Array(await speech.blob.arrayBuffer())] };
    }, { speechKey, pictureId });
    expect(bytes.photo).toEqual([...Buffer.from(png, 'base64')]); expect(bytes.picture).toEqual(bytes.photo); expect(bytes.speech).toEqual([...audio]);
    await other.setViewportSize({ width: 390, height: 844 });
    // Both devices edit the same acknowledged board while offline, then reconnect one at a time.
    await Promise.all([page.evaluate(() => navigator.serviceWorker.ready), other.evaluate(() => navigator.serviceWorker.ready)]);
    await page.context().setOffline(true); await second.setOffline(true);
    await changeTitle(page, 'Edited on tablet'); await changeTitle(other, 'Edited on phone');
    await expect(other.getByRole('button', { name: 'Play Edited on phone', exact: true })).toBeVisible();
    await page.context().setOffline(false);
    await page.getByRole('button', { name: 'Parent settings', exact: true }).click();
    await page.getByRole('button', { name: /^(Log in or create an account|Open account & backup)$/ }).click();
    await expect(page.getByText('All boards and assets are synced.', { exact: true })).toBeVisible();
    await second.setOffline(false);
    await other.getByRole('button', { name: 'Parent settings', exact: true }).click();
    await other.getByRole('button', { name: /^(Log in or create an account|Open account & backup)$/ }).click();
    await expect(other.getByText(/Conflicting edits were kept/)).toBeVisible();
    await expect.poll(async () => (await readLibrary(other)).boards.map((board: any) => board.title)).toEqual(['Edited on tablet', 'Edited on phone (conflict copy)']);
    await other.getByRole('button', { name: 'Continue to boards', exact: true }).click();
    await other.getByRole('button', { name: 'Sign out and keep local boards', exact: true }).click();
    await expect(other.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
    expect((await readLibrary(other)).boards).toHaveLength(2);
    await other.getByRole('button', { name: 'Continue without an account', exact: true }).click();
    await other.getByRole('button', { name: 'Close Parent settings', exact: true }).click();
    await second.setOffline(true); await other.reload();
    await expect(other.getByRole('button', { name: 'Play Edited on tablet', exact: true })).toBeVisible();
    expect(await other.evaluate(() => localStorage.getItem('little-say-firebase-account'))).toBeNull();
  } finally { await second.close(); }
});

test('a parent can skip accounts and finish setup without an account request', async ({ page }) => {
  const accountRequests: string[] = []; page.on('request', request => { if (request.url().includes('/api/account/')) accountRequests.push(request.url()); });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Continue without an account', exact: true }).click(); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start without starter boards', exact: true }).click();
  await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
  expect(accountRequests).toEqual([]);
});


test('cross-tab account changes and server switching never silently redirect a backup', async ({ page, context }) => {
  const emails = [randomUUID() + '@example.test', randomUUID() + '@example.test'];
  for (const email of emails) {
    const created = await page.request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', { data: { email, password, returnSecureToken: true } });
    const { idToken } = await created.json();
    await page.request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo-key', { data: { requestType: 'VERIFY_EMAIL', idToken } });
    const { oobCodes } = await (await page.request.get('http://127.0.0.1:9099/emulator/v1/projects/demo-little-say/oobCodes')).json();
    const code = oobCodes.find((value: { email: string }) => value.email === email);
    expect((await page.request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key', { data: { oobCode: code.oobCode } })).ok()).toBe(true);
  }
  await page.goto('/app');
  await page.getByRole('button', { name: 'Continue without an account', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start without starter boards', exact: true }).click();
  await page.getByRole('button', { name: 'Parent settings', exact: true }).click();
    await page.getByRole('button', { name: /^(Log in or create an account|Open account & backup)$/ }).click();
  await signIn(page, emails[0]);
  await expect(page.getByText('All boards and assets are synced.', { exact: true })).toBeVisible();
  const other = await context.newPage();
  try {
    await other.goto('/app');
    await other.getByRole('button', { name: 'Parent settings', exact: true }).click();
    await other.getByRole('button', { name: /^(Log in or create an account|Open account & backup)$/ }).click();
    await other.getByRole('button', { name: 'Sign out and keep local boards', exact: true }).click();
    await signIn(other, emails[1]);
    await expect(other.getByText('All boards and assets are synced.', { exact: true })).toBeVisible();
    await page.bringToFront();
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(page.getByText('Your session has expired. Sign in again to resume sync.', { exact: true })).toBeVisible();
    await other.bringToFront();
    const sent: string[] = [];
    other.on('request', request => { if (request.url().startsWith('https://different-server.invalid/api/account')) sent.push(request.url()); });
    await other.route('https://different-server.invalid/**', route => route.abort());
    await other.getByRole('button', { name: 'Continue to boards', exact: true }).click();
    await other.getByLabel('Private server address', { exact: true }).fill('https://different-server.invalid');
    await other.getByRole('button', { name: 'Save settings', exact: true }).click();
    await other.getByRole('button', { name: 'Parent settings', exact: true }).click();
    await other.getByRole('button', { name: /^(Log in or create an account|Open account & backup)$/ }).click();
    await other.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(other.getByText('This account belongs to a different server. Restore its server address or sign out before using another account.', { exact: true })).toBeVisible();
    expect(sent).toEqual([]);
  } finally { await other.close(); }
});
