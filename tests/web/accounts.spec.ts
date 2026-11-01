/** @file Exercises illustrated required entry, Home restoration/retry, verified backup, media/conflict recovery, manual cross-tab refresh, and local-preserving sign-out. Verifies conditional email verification in Settings and retained backup detail links. */

import { test, expect, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { createTestAccount, openSignedInApp } from './accountFixture';
import { starterLibrary } from '../fixtures/library';
import { pcmToWav } from '../../apps/server/src/synthesis';
import { waitForAiTurn } from './boardEditor';

const password = 'a test family passphrase';

test('registered accounts create AI boards and retain private ownership on reload', async ({ page, browser }) => {
  const credentials = await openSignedInApp(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start without starter boards', exact: true }).click();
  const accepted = page.waitForResponse(response => response.url().endsWith('/api/boards/propose') && response.status() === 202);
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Create a hello board');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const job = await (await accepted).json();
  await expect.poll(async () => (await readLibrary(page)).boards.length).toBe(1);
  await waitForAiTurn(page);
  const created = (await readLibrary(page)).boards[0];
  expect(created.tiles.length).toBeGreaterThan(0);
  await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).toHaveValue(created.title);
  const owner = (await (await page.request.get('/api/account/session')).json()).account;
  expect(owner).toMatchObject({ email: credentials.email, emailVerified: true, providers: ['password'] });
  expect(await page.evaluate(() => localStorage.getItem('little-say-firebase-account'))).toContain(credentials.email);
  expect((await readLibrary(page)).sync.accountId).toBe(owner.id);
  expect((await page.request.get('/api/account/backup')).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).toHaveValue(created.title);
  expect((await readLibrary(page)).boards[0]).toEqual(created);
  expect((await (await page.request.get('/api/account/session')).json()).account.id).toBe(owner.id);
  expect((await page.request.get(`/api/ai/jobs/${job.id}`)).status()).toBe(200);
  const other = await browser.newContext();
  try {
    expect((await other.request.get(new URL(`/api/ai/jobs/${job.id}`, page.url()).href)).status()).toBe(401);
  } finally { await other.close(); }
});

test('web sign-in gates legacy local boards, cancelled forms, settings links, and signed-out reloads', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Little Say: Learn to Talk!', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue without an account', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('cancelled@example.test');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const library = starterLibrary(); library.settings.autoSpeech = false;
  await page.evaluate(async library => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put({ ...library, settings: { ...library.settings, accountChoiceMade: true } }, 'library'); tx.oncomplete = () => resolve(); }); db.close();
  }, library);
  await page.goto('/app/settings/privacy');
  await expect(page.getByRole('heading', { name: 'Little Say: Learn to Talk!', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/account/backup')).status()).toBe(401);
  await openSignedInApp(page);
  await expect(page.getByRole('button', { name: 'Play Farmyard friends', exact: true })).toBeVisible();
  expect((await readLibrary(page)).boards).toEqual(library.boards);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true); await page.reload();
  await expect(page.getByRole('button', { name: 'Play Farmyard friends', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await signOut(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Little Say: Learn to Talk!', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play Farmyard friends', exact: true })).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign out on this device?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Little Say: Learn to Talk!', exact: true })).toBeVisible();
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
  await page.goto('/app');
}

test('accounts restore all asset types to a fresh device and merge offline conflicts without losing boards', async ({ page, browser }) => {
  test.setTimeout(120000);
  const username = `family_${randomUUID().slice(0, 8)}@example.test`;
  const second = await browser.newContext(); const other = await second.newPage();
  try {
    // Keep the owned photo/picture/speech fixture fixed while app defaults allow automatic AI audio.
    for (const device of [page, other]) await device.route('**/api/speech', route => route.fulfill({ status: 503, json: { error: 'Synthetic unavailable speech' } }));
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Little Say: Learn to Talk!', exact: true })).toBeVisible();
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
    await page.getByRole('button', { name: 'Register', exact: true }).click();
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Verify email', exact: true })).toBeVisible();
    expect((await readLibrary(page)).sync).toBeUndefined();
    const codes = await (await page.request.get('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/emulator/v1/projects/demo-little-say/oobCodes')).json();
    const verification = codes.oobCodes.find((value: { email: string; requestType: string }) => value.email === username && value.requestType === 'VERIFY_EMAIL');
    expect(verification).toBeTruthy();
    const verified = await page.request.post('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key', { data: { oobCode: verification.oobCode } });
    expect(verified.ok()).toBe(true);
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
    await page.getByLabel('Current password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'I’ve verified my email', exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/settings$/);
    await page.getByRole('button', { name: 'Boards', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play Farmyard friends', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Enable backup on this device', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Request persistent browser storage', exact: true })).toHaveCount(0);
    await page.goto('/app/settings/backup');
    await expect(page.getByText('Up to date', { exact: true })).toBeVisible();
    await expect.poll(async () => (await readLibrary(page)).sync.snapshot.assets.length).toBe(3);
    expect(await page.evaluate(() => localStorage.getItem('little-say-firebase-account'))).not.toContain('token');
    await other.goto('/app');
    await signIn(other, username);
    await expect(other).toHaveURL(/\/app$/);
    await expect(other.getByRole('button', { name: 'Play Farmyard friends', exact: true })).toBeVisible();
    await expect(other.getByText('Syncing your content…', { exact: true })).toHaveCount(0);
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
    await page.getByRole('button', { name: /^(Settings|Sign in \/ Register)$/ }).click();
    await page.goto('/app/settings/backup');
    await expect(page.getByText('Up to date', { exact: true })).toBeVisible();
    await second.setOffline(false);
    await other.getByRole('button', { name: /^(Settings|Sign in \/ Register)$/ }).click();
    await other.goto('/app/settings/backup');
    await expect(other.getByText(/Conflicting edits were kept/)).toBeVisible();
    await expect.poll(async () => (await readLibrary(other)).boards.map((board: any) => board.title)).toEqual(['Edited on tablet', 'Edited on phone (conflict copy)']);
    await other.getByRole('button', { name: 'Settings', exact: true }).click();
    await signOut(other);
    await expect(other.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
    expect((await readLibrary(other)).boards).toHaveLength(2);
    await second.setOffline(true); await other.reload();
    await expect(other.getByRole('heading', { name: 'Little Say: Learn to Talk!', exact: true })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Play Edited on tablet', exact: true })).toHaveCount(0);
    expect(await other.evaluate(() => localStorage.getItem('little-say-firebase-account'))).toBeNull();
  } finally { await second.close(); }
});

test('sign-in centers first-sync loading on empty Home and can retry restoration there before setup', async ({ page }) => {
  const credentials = await createTestAccount();
  let release!: () => void;
  const responseReady = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/account/backup', async route => { await responseReady; await route.fulfill({ status: 503, json: { error: 'Restore temporarily unavailable.' } }); });
  try {
    await page.goto('/app/settings/privacy'); await signIn(page, credentials.email);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('heading', { name: 'Syncing your content…', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your soundboards', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New board', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
    await expect(page.getByText('No boards yet', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toHaveCount(0);
    for (const viewport of [{ width: 390, height: 844 }, { width: 1180, height: 900 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(async () => {
        const status = (await page.getByTestId('initial-sync-state').boundingBox())!;
        const header = (await page.getByTestId('app-header-bar').boundingBox())!;
        const contentTop = header.y + header.height;
        return Math.max(Math.abs(status.x + status.width / 2 - viewport.width / 2), Math.abs(status.y + status.height / 2 - (contentTop + viewport.height) / 2));
      }).toBeLessThan(4);
      expect((await page.getByLabel('Syncing content', { exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(50);
    }
  } finally { release(); }
  await expect(page.getByText('Your content couldn’t sync. Restore temporarily unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('initial-sync-state').getByRole('button', { name: 'Retry sync', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toHaveCount(0);
  await page.unroute('**/api/account/backup');
  await page.getByRole('button', { name: 'Retry sync', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
});

test('cross-tab account changes and legacy server overrides never silently redirect a backup', async ({ page, context }) => {
  const emails = [randomUUID() + '@example.test', randomUUID() + '@example.test'];
  for (const email of emails) {
    const created = await page.request.post('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', { data: { email, password, returnSecureToken: true } });
    const { idToken } = await created.json();
    await page.request.post('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo-key', { data: { requestType: 'VERIFY_EMAIL', idToken } });
    const { oobCodes } = await (await page.request.get('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/emulator/v1/projects/demo-little-say/oobCodes')).json();
    const code = oobCodes.find((value: { email: string }) => value.email === email);
    expect((await page.request.post('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key', { data: { oobCode: code.oobCode } })).ok()).toBe(true);
  }
  await page.goto('/app'); await signIn(page, emails[0]);
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start without starter boards', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const other = await context.newPage();
  try {
    await other.goto('/app');
    await other.getByRole('button', { name: /^(Settings|Sign in \/ Register)$/ }).click();
    await signOut(other);
    await signIn(other, emails[1]);
    await expect(other).toHaveURL(/\/app$/);
    await other.getByRole('button', { name: 'Settings', exact: true }).click();
    await other.goto('/app/settings/backup');
    await expect(other.getByText('Up to date', { exact: true })).toBeVisible();
    await page.bringToFront();
    await page.getByRole('button', { name: 'Boards', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh content', exact: true }).click();
    await expect(page.getByText('Your session has expired. Sign in again to resume sync.', { exact: true })).toBeVisible();
    await other.bringToFront();
    const sent: string[] = [];
    other.on('request', request => { if (request.url().startsWith('https://different-server.invalid/api/account')) sent.push(request.url()); });
    await other.route('https://different-server.invalid/**', route => route.abort());
    await other.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
      await new Promise<void>(resolve => {
        const tx = db.transaction('state', 'readwrite'); const store = tx.objectStore('state'); const r = store.get('library');
        r.onsuccess = () => { const library = r.result; library.settings.backendUrl = 'https://different-server.invalid'; store.put(library, 'library'); };
        tx.oncomplete = () => resolve();
      }); db.close();
    });
    await other.reload();
    await other.goto('/app/settings/backup');
    await expect(other.getByText('Up to date', { exact: true })).toBeVisible();
    expect((await readLibrary(other)).settings.backendUrl).toBe('');
    expect(sent).toEqual([]);
  } finally { await other.close(); }
});
