/** @file Verifies explicit creation-draft retention, guarded exits, reload isolation, clarification recovery, first-save recency, and write retry in the unified editor. */
import { expect, test, type Page } from '@playwright/test';
import { openExistingLibrary } from './existingLibrary';
import { openBoardPictures, waitForAiTurn } from './boardEditor';

async function saved(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('little-say'); r.onsuccess = () => resolve(r.result); });
    const value = await new Promise<any>(resolve => { const r = db.transaction('state').objectStore('state').get('library'); r.onsuccess = () => resolve(r.result); }); db.close(); return value;
  });
}
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const prompt = (page: Page) => page.getByRole('textbox', { name: 'Message to AI', exact: true });
test.beforeEach(async ({ page }) => { await openExistingLibrary(page, { voiceSources: { 'en-US': 'device', 'ru-RU': 'device' } }); });

for (const exit of ['page back', 'browser back']) test(`an untouched creation asks before ${exit} and discards without adding a board`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await button(page, 'New board').click();
  if (exit === 'browser back') await page.goBack(); else await button(page, 'Boards').click();
  await expect(page.getByRole('heading', { name: 'Save your draft?', exact: true })).toBeVisible();
  await expect(button(page, 'Save draft')).toBeDisabled();
  await expect(button(page, 'Discard')).toBeInViewport({ ratio: 1 });
  await expect(button(page, 'Keep editing')).toBeInViewport({ ratio: 1 });
  await button(page, 'Discard').click();
  await expect(button(page, 'New board')).toBeVisible();
  expect((await saved(page)).creationDraft).toBeUndefined(); expect((await saved(page)).boards).toHaveLength(3);
  await button(page, 'New board').click(); await expect(prompt(page)).toHaveValue('');
});

test('only Save draft retains progress; reload ignores later unsaved changes and Discard clears the saved snapshot', async ({ page }) => {
  await button(page, 'New board').click();
  await prompt(page).fill('My animals');
  await openBoardPictures(page);
  await button(page, 'Picture source: Automatic').click(); await button(page, 'Emoji only').click();
  await button(page, 'Save picture settings').click();
  await button(page, 'Boards').click(); await button(page, 'Keep editing').click();
  await expect(prompt(page)).toHaveValue('My animals'); expect((await saved(page)).creationDraft).toBeUndefined();
  await button(page, 'Boards').click(); await button(page, 'Save draft').click();
  await expect(button(page, 'Resume draft')).toBeVisible();
  expect((await saved(page)).creationDraft.prompt).toBe('My animals');
  await page.reload(); await button(page, 'Resume draft').click();
  await expect(prompt(page)).toHaveValue('My animals');
  await prompt(page).fill('Unsaved replacement'); await page.reload();
  await expect(prompt(page)).toHaveValue('My animals');
  await openBoardPictures(page); await expect(button(page, 'Picture source: Emoji only')).toBeVisible();
  await button(page, 'Close Board pictures').click();
  await page.goBack(); await button(page, 'Discard').click();
  await expect(button(page, 'New board')).toBeVisible(); await page.reload();
  await button(page, 'New board').click(); await expect(prompt(page)).toHaveValue('');
  await openBoardPictures(page); await expect(button(page, 'Picture source: Automatic')).toBeVisible();
  expect((await saved(page)).creationDraft).toBeUndefined();
});

test('saved clarification history resumes and the first completed AI turn consumes the saved draft', async ({ page }) => {
  const requests: any[] = [];
  await page.route('**/api/boards/propose', route => {
    const input = route.request().postDataJSON(); requests.push(input);
    return route.fulfill({ json: { boardId: null, baseRevision: null, proposal: {
      title: 'Animal words', explanation: requests.length === 1 ? 'Which animals?' : 'Here is Cow.', needsClarification: requests.length === 1, playLanguages: ['en-US'],
      tiles: requests.length === 1 ? [] : [{ existingId: null, label: 'Cow', speech: 'Cow', language: 'en-US', emoji: '🐄', color: 'sage', languageMode: 'fixed', translations: [] }],
    } } });
  });
  await button(page, 'New board').click(); await prompt(page).fill('Some animals'); await button(page, 'Send message').click();
  await expect(page.getByText('Which animals?', { exact: true })).toBeVisible();
  await prompt(page).fill('Cow'); await button(page, 'Boards').click(); await button(page, 'Save draft').click();
  await expect(button(page, 'Resume draft')).toBeVisible(); await page.reload(); await button(page, 'Resume draft').click();
  await expect(prompt(page)).toHaveValue('Cow'); await expect(page.getByText('Which animals?', { exact: true })).toBeVisible();
  await button(page, 'Send message').click(); await waitForAiTurn(page);
  expect(requests[1].conversation.history).toEqual([{ prompt: 'Some animals', reply: 'Which animals?' }]);
  expect((await saved(page)).creationDraft).toBeUndefined(); expect((await saved(page)).boards).toHaveLength(4);
  await button(page, 'Boards').click(); await expect(button(page, 'New board')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Save your draft?', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('recent-board').getByTestId('board-card-title')).toHaveText('Animal words');
  await page.reload();
  await expect(page.getByTestId('board-card-title')).toHaveText(['Animal words', 'Farmyard friends', 'My little words', 'Our family']);
});

test('failed Save and Discard keep the draft and allow retry', async ({ page }) => {
  await button(page, 'New board').click(); await prompt(page).fill('My animals');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) { if ((window as any).__failWrites) throw new DOMException('Storage full', 'QuotaExceededError'); return put.apply(this, args as any); };
    (window as any).__failWrites = true;
  });
  await button(page, 'Boards').click(); await button(page, 'Save draft').click();
  await expect(page.getByText('Your draft could not be saved. Please try again.', { exact: true })).toBeVisible();
  expect((await saved(page)).creationDraft).toBeUndefined();
  await page.evaluate(() => { (window as any).__failWrites = false; }); await button(page, 'Save draft').click();
  await button(page, 'Resume draft').click(); await expect(prompt(page)).toHaveValue('My animals');
  await page.evaluate(() => { (window as any).__failWrites = true; });
  await button(page, 'Boards').click(); await button(page, 'Discard').click();
  await expect(page.getByText('Your draft could not be discarded. Please try again.', { exact: true })).toBeVisible();
  expect((await saved(page)).creationDraft.prompt).toBe('My animals');
  await page.evaluate(() => { (window as any).__failWrites = false; }); await button(page, 'Discard').click();
  await expect(button(page, 'New board')).toBeVisible(); expect((await saved(page)).creationDraft).toBeUndefined();
});
