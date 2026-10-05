/** @file Exercises optional account consent, full photo/picture/audio restore, offline edits, conflicts, and local-preserving sign-out in real browsers. */

import { test, expect, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { starterLibrary } from '../fixtures/library';
import { pcmToWav } from '../../apps/server/src/synthesis';

const password = 'a test family passphrase';
async function readLibrary(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
    const library = await new Promise<any>(resolve => { const r = db.transaction('state').objectStore('state').get('library'); r.onsuccess = () => resolve(r.result); }); db.close(); return library;
  });
}
async function signIn(page: Page, username: string) {
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('textbox', { name: 'Account name', exact: true }).fill(username);
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
  const username = `family_${randomUUID().slice(0, 8)}`;
  const second = await browser.newContext(); const other = await second.newPage();
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
    // Seed a device with already-owned files. Everything after this uses the live account API.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=';
    const pictureId = createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex');
    const audio = pcmToWav(Buffer.alloc(2400)); const audioId = createHash('sha256').update(audio).digest('hex');
    const library = starterLibrary(); library.settings.autoSpeech = false; library.settings.aiConsent = false;
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
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await mkdir('artifacts/screenshots/accounts', { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350); // Capture the optional account choice after the modal fade.
    await page.screenshot({ path: 'artifacts/screenshots/accounts/optional-phone.png' });
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByRole('textbox', { name: 'Account name', exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill(password);
    await expect(page.getByText(/Continuing uploads the boards/)).toBeVisible();
    await mkdir('artifacts/screenshots/accounts', { recursive: true });
    await page.waitForTimeout(350); // Let the native-style modal fade finish before reviewer capture.
    await page.screenshot({ path: 'artifacts/screenshots/accounts/create-tablet.png' });
    await page.getByRole('button', { name: 'Create account & enable sync', exact: true }).click();
    await expect(page.getByLabel('Recovery code', { exact: true })).toHaveValue(/^[a-f0-9]{48}$/);
    await page.getByRole('button', { name: 'I saved my recovery code', exact: true }).click();
    await expect(page.getByText('All boards and assets are synced.', { exact: true })).toBeVisible();
    await expect.poll(async () => (await readLibrary(page)).sync.snapshot.assets.length).toBe(3);
    expect(await page.evaluate(() => localStorage.getItem('little-say-account'))).not.toContain('token');
    await other.goto('/');
    await other.getByRole('button', { name: 'Sign in or restore boards', exact: true }).click();
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
    await other.waitForTimeout(350);
    await other.screenshot({ path: 'artifacts/screenshots/accounts/restored-phone.png' });
    await other.setViewportSize({ width: 1180, height: 900 });
    await other.screenshot({ path: 'artifacts/screenshots/accounts/restored-tablet.png' });
    await other.setViewportSize({ width: 390, height: 844 });
    // Both devices edit the same acknowledged board while offline, then reconnect one at a time.
    await Promise.all([page.evaluate(() => navigator.serviceWorker.ready), other.evaluate(() => navigator.serviceWorker.ready)]);
    await page.context().setOffline(true); await second.setOffline(true);
    await changeTitle(page, 'Edited on tablet'); await changeTitle(other, 'Edited on phone');
    await expect(other.getByRole('button', { name: 'Play Edited on phone', exact: true })).toBeVisible();
    await page.context().setOffline(false);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByText('All boards and assets are synced.', { exact: true })).toBeVisible();
    await second.setOffline(false);
    await other.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(other.getByText(/Conflicting edits were kept/)).toBeVisible();
    await expect.poll(async () => (await readLibrary(other)).boards.map((board: any) => board.title)).toEqual(['Edited on tablet', 'Edited on phone (conflict copy)']);
    await other.getByRole('button', { name: 'Sign out and keep local boards', exact: true }).click();
    await expect(other.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    expect((await readLibrary(other)).boards).toHaveLength(2);
    await other.getByRole('button', { name: 'Close Settings', exact: true }).click();
    await second.setOffline(true); await other.reload();
    await expect(other.getByRole('button', { name: 'Play Edited on tablet', exact: true })).toBeVisible();
    expect(await other.evaluate(() => localStorage.getItem('little-say-account'))).toBeNull();
  } finally { await second.close(); }
});

test('setup can be completed without an account or an account request', async ({ page }) => {
  const accountRequests: string[] = []; page.on('request', request => { if (request.url().includes('/api/account/')) accountRequests.push(request.url()); });
  await page.goto('/'); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start without starter boards', exact: true }).click();
  await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
  expect(accountRequests).toEqual([]);
});
