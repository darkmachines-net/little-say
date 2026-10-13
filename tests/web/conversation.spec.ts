/**
 * @file Exercises conversational board creation and edits, including clarification, cancellation, and
 * draft application and text review without app microphone capture.
 */

import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openExistingLibrary } from './existingLibrary';

const word = (label: string) => ({ existingId: null, label, speech: label, language: 'en-US', emoji: '🐄', color: 'sage', languageMode: 'fixed', translations: [] });
const proposal = (label = 'Cow') => ({ title: 'Animal words', explanation: `Here is ${label}.`, needsClarification: false, playLanguages: ['en-US'], tiles: [word(label)] });
const envelope = (value = proposal()) => ({ boardId: null, baseRevision: null, proposal: value });
async function saved(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
    const value = await new Promise<any>(resolve => { const r = db.transaction('state').objectStore('state').get('library'); r.onsuccess = () => resolve(r.result); }); db.close(); return value;
  });
}
async function send(page: Page, message: string) {
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill(message);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}
test.beforeEach(async ({ page }) => { await openExistingLibrary(page); });

test('manual creation starts from the library and suggestions stay in the conversation without an opt-in screen', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/boards/propose', route => { requests++; return route.fulfill({ json: envelope() }); });
  await page.getByRole('button', { name: 'Build manually', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).toHaveValue('Our new board');
  await expect(page.getByTestId('ai-conversation')).toHaveCount(0);
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Build manually', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '🐾 Farm animals', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toHaveValue('Create six farm animal tiles including cow, sheep, and horse.');
  await expect(page).toHaveURL(/#boards\/new$/);
  expect(requests).toBe(0); expect((await saved(page)).settings.aiConsent).toBe(false);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeEnabled();
  await expect(page.getByText('Use AI services?', { exact: true })).toHaveCount(0);
  expect(requests).toBe(1);
});

test('editing routes survive reload and return to their source board without saving a draft', async ({ page }) => {
  const original = (await saved(page)).boards[0];
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#boards/${original.id}/ai$`));
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('An unsaved message');
  await page.reload();
  await expect(page.getByTestId('ai-canvas')).toContainText('Farmyard friends');
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Back to board', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).toHaveValue('Farmyard friends');
  expect((await saved(page)).boards[0]).toEqual(original);
});

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
  await send(page, 'Make two animal cards. Ask me which ones.');
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
  await send(page, 'Replace Horse with Goat');
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
  await send(page, 'A cow');
  await expect(page.getByTestId('ai-working')).toBeVisible();
  await page.getByRole('button', { name: 'Stop request', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toHaveValue('A cow');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('ai-draft')).toContainText('Cow');
  release();
  expect(requests[1].conversation.history).toEqual([]);
  await expect(page.getByText('A cow', { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('ai-draft')).not.toContainText('Wrong late word');
  await page.getByRole('button', { name: 'Back to boards', exact: true }).click();
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
  await send(page, 'Cow');
  await expect(page.getByTestId('ai-draft')).toContainText('Cow');
  await send(page, 'Change its color');
  await expect(page.getByText('Please try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toHaveValue('Change its color');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Which color?', { exact: true })).toBeVisible();
  expect(requests[2].conversation.history).toHaveLength(1);
  await expect(page.getByTestId('ai-draft')).toContainText('Waiting for your answer');
  await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toHaveCount(0);
  await send(page, 'Blue');
  await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeEnabled();
  expect(requests[3].conversation.history).toHaveLength(2);
  expect(requests[3].conversation.draft).toEqual(proposal());
  for (const name of ['Use this board', 'Send message', 'Back to boards']) await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'artifacts/screenshots/ai-conversation-phone.png' });
});

test('a failed save keeps the draft and retry creates exactly one board', async ({ page }) => {
  await page.route('**/api/boards/propose', route => route.fulfill({ json: envelope() }));
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await send(page, 'Cow');
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

for (const outcome of ['failure', 'success'] as const) test(`browser history preserves a pending draft save through ${outcome}`, async ({ page }) => {
  await page.route('**/api/boards/propose', route => route.fulfill({ json: envelope() }));
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await send(page, 'Cow');
  await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeEnabled();
  // Retain a same-document Forward destination while the current draft stays mounted.
  await page.evaluate(() => { history.pushState({}, '', '#other'); history.back(); });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#boards/new');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) {
      const result = put.apply(this, args as any);
      if (this.name === 'state' && !(window as any).__heldWrite) {
        (window as any).__heldWrite = true;
        let hold = true;
        const store = this;
        const keepAlive = () => { if (hold) store.get('library').onsuccess = keepAlive; };
        keepAlive();
        (window as any).__releaseWrite = (fail: boolean) => { hold = false; if (fail) store.transaction.abort(); };
      }
      return result;
    };
  });
  await page.getByRole('button', { name: 'Use this board', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__releaseWrite))).toBe(true);
  await page.goForward();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#boards/new');
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goBack();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#boards/new');
    await expect(page.getByTestId('ai-draft')).toContainText('Cow');
  }
  await expect(page.getByRole('button', { name: 'Back to boards', exact: true })).toBeDisabled();
  await page.evaluate(fail => (window as any).__releaseWrite(fail), outcome === 'failure');
  if (outcome === 'failure') {
    await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeEnabled();
    await expect(page.getByTestId('ai-conversation')).toContainText(/abort/i);
    expect((await saved(page)).boards).toHaveLength(3);
    await page.getByRole('button', { name: 'Use this board', exact: true }).click();
  }
  await expect(page.getByTestId('ai-conversation')).toHaveCount(0);
  expect((await saved(page)).boards).toHaveLength(4);
  // Save protection ends: ordinary Back and Forward can dismiss and reopen a fresh workspace.
  await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
  await page.goBack();
  await expect(page.getByTestId('ai-conversation')).toHaveCount(0);
  await page.goForward();
  await expect(page.getByTestId('ai-conversation')).toBeVisible();
});

for (const dismissal of ['page back', 'browser back']) test(`prompt text stays editable until sent and ${dismissal} leaves without microphone access`, async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__microphoneRequests = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      (window as any).__microphoneRequests++;
      throw new Error('Little Say must not capture prompt audio');
    } });
  });
  const requests: any[] = [];
  let transcriptions = 0;
  await page.route('**/api/transcribe', route => { transcriptions++; return route.abort(); });
  await page.route('**/api/boards/propose', route => { requests.push(route.request().postDataJSON()); return route.fulfill({ json: envelope() }); });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Voice prompt', exact: true })).toHaveCount(0);
  await expect(page.getByText('What would you like on your board? Type a message or use your keyboard’s dictation.', { exact: true })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Message to AI', exact: true });
  await input.click();
  await expect(input).toBeFocused();
  // Keyboard dictation commits ordinary text; browser automation verifies the resulting input flow.
  await input.fill('Cow and бабушка');
  expect(requests).toHaveLength(0);
  await input.fill('Cow');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('ai-draft')).toBeVisible();
  await input.fill('Make the cow blue');
  expect(requests).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeDisabled();
  await input.fill('Make the cow green');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeEnabled();
  expect(requests[1].prompt).toBe('Make the cow green');
  expect(requests[1].conversation.history).toHaveLength(1);
  await input.fill('An unsent follow-up');
  if (dismissal === 'browser back') await page.goBack();
  else await page.getByRole('button', { name: 'Back to boards', exact: true }).click();
  await expect(page.getByTestId('ai-conversation')).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(transcriptions).toBe(0);
  expect(await page.evaluate(() => (window as any).__microphoneRequests)).toBe(0);
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

test('a new phone conversation starts with its full data-use introduction visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  const intro = page.getByText(/Messages and board words go to AI/);
  await expect(intro).toContainText('without automatic deletion');
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  const panel = (await page.getByTestId('ai-transcript').boundingBox())!;
  const text = (await intro.boundingBox())!;
  expect(text.y).toBeGreaterThanOrEqual(panel.y);
  expect(text.y + text.height).toBeLessThanOrEqual(panel.y + panel.height);
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Voice prompt', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/screenshots/ai-conversation-text-entry-phone.png' });
});
