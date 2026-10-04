/**
 * @file Exercises conversational board creation and edits, including clarification, cancellation, and
 * draft application.
 */

import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openExistingLibrary } from './existingLibrary';

const word = (label: string) => ({ existingId: null, label, speech: label, language: 'en-US', emoji: '🐄', color: 'sage', languageMode: 'fixed', translations: [] });
const proposal = (label = 'Cow') => ({ title: 'Animal words', explanation: `Here is ${label}.`, needsClarification: false, playLanguages: ['en-US'], tiles: [word(label)] });
const envelope = (value = proposal()) => ({ boardId: null, baseRevision: null, proposal: value });
async function saved(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say', 2); r.onsuccess = () => resolve(r.result); });
    const value = await new Promise<any>(resolve => { const r = db.transaction('state').objectStore('state').get('library'); r.onsuccess = () => resolve(r.result); }); db.close(); return value;
  });
}
async function send(page: Page, message: string, consent = false) {
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill(message);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  if (consent) await page.getByRole('button', { name: 'Continue with AI', exact: true }).click();
}
test.beforeEach(async ({ page }) => { await openExistingLibrary(page); });

test('clarification, draft and refinement stay in one conversation until explicitly saved', async ({ page }) => {
  const requests: any[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/boards/propose', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) { await pending; await route.fulfill({ json: envelope({ ...proposal(), explanation: 'Which two animals would you like?', needsClarification: true, tiles: [] }) }); }
    else await route.fulfill({ json: envelope(requests.length === 2 ? { ...proposal(), tiles: [word('Cow'), word('Sheep')] } : { ...proposal(), title: 'Two animals', explanation: 'The cow is now blue; the sheep stays the same.', tiles: [{ ...word('Cow'), color: 'sky' }, word('Sheep')] }) });
  });
  const count = (await saved(page)).boards.length;
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await send(page, 'Make two animal cards. Ask me which ones.', true);
  await expect(page.getByTestId('ai-working')).toBeVisible();
  await expect(page.getByText(/Working on your draft… · [1-9]/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop request', exact: true })).toBeEnabled();
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshots/ai-conversation-working.png' });
  release();
  await expect(page.getByText('Which two animals would you like?', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toHaveCount(0);
  await send(page, 'Cow and sheep');
  await expect(page.getByTestId('ai-draft')).toContainText('Sheep');
  expect(requests[1].conversation.history).toEqual([{ prompt: 'Make two animal cards. Ask me which ones.', reply: 'Which two animals would you like?' }]);
  expect(requests[1].conversation.draft).toBeNull();
  expect((await saved(page)).boards).toHaveLength(count);
  await send(page, 'Make the cow blue');
  await expect(page.getByTestId('ai-draft')).toContainText('Two animals');
  expect(requests[2].conversation.history).toHaveLength(2);
  expect(requests[2].conversation.draft.tiles.map((t: any) => t.label)).toEqual(['Cow', 'Sheep']);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.screenshot({ path: 'artifacts/screenshots/ai-conversation-draft.png' });
  await page.getByRole('button', { name: 'Use this board', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).toHaveValue('Two animals');
  const boards = (await saved(page)).boards;
  expect(boards).toHaveLength(count + 1);
  expect(boards.at(-1).tiles[0].color).toBe('sky');
});

test('editing refines the latest draft while keeping source IDs, languages and photos private', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Choose photo', exact: true }).click();
  await (await chooser).setFiles({ name: 'cow.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64') });
  await page.getByRole('button', { name: 'Use photo', exact: true }).click();
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  const original = (await saved(page)).boards[0];
  const requests: any[] = [];
  await page.route('**/api/boards/propose', async route => {
    const input = route.request().postDataJSON(); requests.push(input);
    const tiles = input.conversation.draft?.tiles ?? input.board.tiles.map((t: any) => t.label === 'Horse' ? word('Goat') : { ...word(t.label), existingId: t.id, emoji: t.emoji ?? '', language: t.language, color: t.color });
    await route.fulfill({ json: { boardId: input.board.id, baseRevision: input.board.revision, proposal: { ...proposal(), title: requests.length === 1 ? 'Our animals' : 'Our favorite animals', explanation: 'Your draft is updated.', playLanguages: input.board.playLanguages, tiles } } });
  });
  await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
  await send(page, 'Replace Horse with Goat', true);
  await expect(page.getByTestId('ai-draft')).toContainText('Goat');
  await send(page, 'Call it Our favorite animals');
  await expect(page.getByTestId('ai-draft')).toContainText('Our favorite animals');
  expect(requests[1].board).toEqual(requests[0].board);
  expect(requests[1].conversation.draft.tiles.find((t: any) => t.label === 'Goat').existingId).toBeNull();
  expect(JSON.stringify(requests)).not.toContain(original.tiles[0].illustration.assetId);
  expect((await saved(page)).boards[0]).toEqual(original);
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit tile Goat', exact: true })).toBeVisible();
  const result = (await saved(page)).boards[0];
  expect(result.tiles[0].illustration).toEqual(original.tiles[0].illustration);
  expect(result.tiles.find((t: any) => t.label === 'Goat').id).not.toBe(original.tiles.find((t: any) => t.label === 'Horse').id);
  await page.getByRole('button', { name: 'Undo last board change', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit tile Horse', exact: true })).toBeVisible();
});

test('stopping and retrying ignores late replies and does not duplicate conversation turns', async ({ page }) => {
  const requests: any[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/boards/propose', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) { await pending; await route.fulfill({ json: envelope(proposal('Wrong late word')) }).catch(() => {}); }
    else await route.fulfill({ json: envelope() });
  });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await send(page, 'A cow', true);
  await expect(page.getByTestId('ai-working')).toBeVisible();
  await page.getByRole('button', { name: 'Stop request', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toHaveValue('A cow');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('ai-draft')).toContainText('Cow');
  release();
  expect(requests[1].conversation.history).toEqual([]);
  await expect(page.getByText('A cow', { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('ai-draft')).not.toContainText('Wrong late word');
  await page.getByRole('button', { name: 'Close New board', exact: true }).click();
  expect((await saved(page)).boards).toHaveLength(3);
});

test('failed follow-ups and clarification preserve the previous draft and small-screen controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requests: any[] = [];
  await page.route('**/api/boards/propose', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 2) await route.fulfill({ status: 502, json: { error: 'Please try again.' } });
    else if (requests.length === 3) await route.fulfill({ json: envelope({ ...proposal(), needsClarification: true, explanation: 'Which color?', tiles: [] }) });
    else await route.fulfill({ json: envelope() });
  });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await send(page, 'Cow', true);
  await expect(page.getByTestId('ai-draft')).toContainText('Cow');
  await send(page, 'Change its color');
  await expect(page.getByText('Please try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toHaveValue('Change its color');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Which color?', { exact: true })).toBeVisible();
  expect(requests[2].conversation.history).toHaveLength(1);
  await expect(page.getByTestId('ai-draft')).toContainText('Previous draft');
  await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toHaveCount(0);
  await send(page, 'Blue');
  await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeEnabled();
  expect(requests[3].conversation.history).toHaveLength(2);
  expect(requests[3].conversation.draft).toEqual(proposal());
  for (const name of ['Use this board', 'Voice prompt', 'Send message', 'Close New board']) await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'artifacts/screenshots/ai-conversation-phone.png' });
});

test('a failed save keeps the draft and retry creates exactly one board', async ({ page }) => {
  await page.route('**/api/boards/propose', route => route.fulfill({ json: envelope() }));
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await send(page, 'Cow', true);
  await expect(page.getByTestId('ai-draft')).toBeVisible();
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args: any[]) { if ((window as any).__failWrites) throw new DOMException('Storage full', 'QuotaExceededError'); return put.apply(this, args as any); }; (window as any).__failWrites = true; });
  await page.getByRole('button', { name: 'Use this board', exact: true }).click();
  await expect(page.getByTestId('ai-conversation')).toContainText('Storage full');
  expect((await saved(page)).boards).toHaveLength(3);
  await page.evaluate(() => { (window as any).__failWrites = false; });
  await page.getByRole('button', { name: 'Use this board', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).toHaveValue('Animal words');
  expect((await saved(page)).boards).toHaveLength(4);
});

for (const dismissal of ['close button', 'outside click']) test(`voice transcripts can be reviewed for follow-ups and ${dismissal} releases the microphone`, async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__stoppedTracks = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => ({ getTracks: () => [{ stop: () => { (window as any).__stoppedTracks++; } }] }) });
    class Recorder {
      static isTypeSupported() { return true; }
      state = 'inactive'; mimeType = 'audio/webm'; ondataavailable: any; onstop: any;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['test voice '.repeat(20)]) }); queueMicrotask(() => this.onstop?.()); }
    }
    (window as any).MediaRecorder = Recorder;
  });
  const requests: any[] = [];
  await page.route('**/api/transcribe', route => route.fulfill({ json: { text: 'Make the cow blue' } }));
  await page.route('**/api/boards/propose', route => { requests.push(route.request().postDataJSON()); return route.fulfill({ json: envelope() }); });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await send(page, 'Cow', true);
  await expect(page.getByTestId('ai-draft')).toBeVisible();
  await page.getByRole('button', { name: 'Voice prompt', exact: true }).click();
  await page.getByRole('button', { name: /^Stop ·/ }).click();
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toHaveValue('Make the cow blue');
  expect(requests).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Make the cow green');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeEnabled();
  expect(requests[1].prompt).toBe('Make the cow green');
  expect(requests[1].conversation.history).toHaveLength(1);
  await page.getByRole('button', { name: 'Voice prompt', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Stop ·/ })).toBeVisible();
  if (dismissal === 'outside click') await page.getByTestId('modal-backdrop').click({ position: { x: 4, y: 4 } });
  else await page.getByRole('button', { name: 'Close New board', exact: true }).click();
  await expect(page.getByTestId('ai-conversation')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__stoppedTracks)).toBe(2);
});

test('a capture-time recorder error releases the microphone and lets the parent retry', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__stoppedTracks = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => ({ getTracks: () => [{ stop: () => { (window as any).__stoppedTracks++; } }] }) });
    class Recorder {
      static isTypeSupported() { return true; }
      state = 'inactive'; mimeType = 'audio/webm'; onerror: any;
      constructor() { (window as any).__recorder = this; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; }
    }
    (window as any).MediaRecorder = Recorder;
  });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Our family');
  await page.getByRole('button', { name: 'Voice prompt', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with AI', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Stop ·/ })).toBeVisible();
  await page.evaluate(() => (window as any).__recorder.onerror(new Event('error')));
  await expect(page.getByText('The recording failed. Please try again.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__stoppedTracks)).toBe(1);
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toHaveValue('Our family');
  await page.getByRole('button', { name: 'Voice prompt', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Stop ·/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close New board', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__stoppedTracks)).toBe(2);
});

test('the compact editor fits tablet orientations and keeps reordering in the tile dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toHaveCount(0);
  for (const size of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    for (const name of ['Edit with AI', 'Add a tile', 'Prepare missing audio (6)', 'Duplicate board', 'Delete board', 'Languages', 'Play board']) await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Edit tile Duck', exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `artifacts/screenshots/editor-${size.width}.png` });
  }
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Move Cow earlier', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Move Cow later', exact: true }).click();
  await expect(page.getByText('Position 2 of 6', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect(page.getByTestId('editor-preview').getByRole('button').nth(1)).toHaveAccessibleName('Edit tile Cow');
});
