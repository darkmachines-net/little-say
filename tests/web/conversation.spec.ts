/** @file Verifies example-led AI input, creation recency, automatic turns, Undo/Redo and branching, save/conflict recovery, keyboard-sized layouts, and dashboard return. */
import { expect, test, type Page, type Route } from '@playwright/test';
import { waitForAiTurn } from './boardEditor';
import { mkdir } from 'node:fs/promises';
import { openExistingLibrary } from './existingLibrary';

const word = (label: string, existingId: string | null = null) => ({ existingId, label, speech: label, language: 'en-US', emoji: '🐄', color: 'sage', languageMode: 'fixed', translations: [] });
const proposal = (label = 'Cow') => ({ title: 'Animal words', explanation: 'Your suggestion is ready.', needsClarification: false, playLanguages: ['en-US'], tiles: [word(label)] });
async function respond(route: Route, value = proposal()) {
  const input = route.request().postDataJSON();
  await route.fulfill({ json: { boardId: input.board?.id ?? null, baseRevision: input.board?.revision ?? null, proposal: value } });
}
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
async function add(page: Page, label: string) {
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  await page.getByRole('textbox', { name: 'Words on the tile', exact: true }).fill(label);
  await page.getByRole('textbox', { name: 'What it says', exact: true }).fill(label);
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  const close = page.getByRole('button', { name: 'Close Board pictures', exact: true });
  if (await close.count()) await close.click();
}
test.beforeEach(async ({ page }) => { await openExistingLibrary(page, { voiceSources: { 'en-US': 'device', 'ru-RU': 'device' } }); });

test('one entry opens an empty local draft; direct creation needs no AI and cancel adds nothing', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/boards/propose', route => { requests++; return respond(route); });
  const count = (await saved(page)).boards.length;
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue('New board');
  await expect(page.getByText(/^\d+ \/ 24$/)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message to AI' })).toHaveAttribute('placeholder', /Six farm animals/);
  await expect(page.getByRole('button', { name: 'Play board', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Build manually|Edit with AI|History/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  await page.getByRole('button', { name: 'Close Edit tile', exact: true }).click();
  await expect(page.getByTestId('editor-preview').getByRole('button')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Board title' }).fill('Our snacks');
  await page.getByRole('textbox', { name: 'Message to AI' }).fill('Maybe add drinks');
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect((await saved(page)).boards).toHaveLength(count);
  await expect(page.getByTestId('recent-board')).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue('Our snacks');
  await expect(page.getByRole('textbox', { name: 'Message to AI' })).toHaveValue('Maybe add drinks');
  await add(page, 'Water');
  await expect(page.getByRole('button', { name: 'Edit tile Water', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#boards\/[^/]+\/edit$/);
  await expect.poll(async () => (await saved(page)).boards.length).toBe(count + 1);
  expect(requests).toBe(0); expect((await saved(page)).settings.aiConsent).toBe(false);
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await expect(page.getByTestId('recent-board').getByTestId('board-card-title')).toHaveText('Our snacks');
  await page.reload();
  await expect(page.getByTestId('board-card-title')).toHaveText(['Our snacks', 'Farmyard friends', 'My little words', 'Our family']);
});

test('clarification and follow-ups share Undo/Redo with direct edits, including restoration from an empty draft', async ({ page }) => {
  const requests: any[] = [];
  await page.route('**/api/boards/propose', route => {
    const input = route.request().postDataJSON(); requests.push(input);
    if (requests.length === 1) return respond(route, { ...proposal(), explanation: 'Which animals?', needsClarification: true, tiles: [] });
    if (requests.length === 2) return respond(route, { ...proposal(), tiles: [word('Cow'), word('Sheep')] });
    return respond(route, { ...proposal(), title: 'Our animals', tiles: input.board.tiles.map((t: any) => ({ ...word(t.label, t.id), color: 'sky' })) });
  });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Six farm animals');
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Which animals?', { exact: true })).toBeVisible();
  await send(page, 'Cow and sheep');
  await waitForAiTurn(page);
  await expect(page.getByTestId('editor-preview')).toContainText('Sheep');
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('textbox', { name: 'Words on the tile' }).fill('Moo');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await page.getByRole('button', { name: 'Close Board pictures', exact: true }).click();
  await send(page, 'Make them blue');
  await waitForAiTurn(page);
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue('Our animals');
  expect(requests[2].board.tiles[0].label).toBe('Moo');
  expect(requests[2].conversation.draft).toBeNull(); expect(requests[2].conversation.history).toHaveLength(2);
  await expect(page.getByRole('button', { name: 'Edit tile Moo', exact: true })).toBeVisible();
  expect((await saved(page)).boards).toHaveLength(4);
  const original = (await saved(page)).boards.at(-1);
  const recency = (await saved(page)).boardLastPlayedAt[original.id];
  await expect(page.getByRole('textbox', { name: 'Message to AI' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo last board change' }).click();
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue('Animal words');
  await expect(page.getByTestId('editor-preview')).toContainText('Moo');
  await page.getByRole('button', { name: 'Undo last board change' }).click();
  await expect(page.getByTestId('editor-preview')).toContainText('Cow');
  await page.getByRole('button', { name: 'Undo last board change' }).click();
  await expect(page.getByTestId('editor-preview').getByRole('button')).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).boards.length).toBe(3);
  const redo = page.getByRole('button', { name: 'Redo last board change', exact: true });
  await expect(page.getByRole('button', { name: 'Undo last board change', exact: true })).toBeDisabled();
  await redo.click();
  await expect(page.getByRole('button', { name: 'Edit tile Cow', exact: true })).toBeVisible();
  await expect.poll(async () => (await saved(page)).boards.length).toBe(4);
  await redo.click();
  await expect(page.getByRole('button', { name: 'Edit tile Moo', exact: true })).toBeVisible();
  await redo.click();
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue('Our animals');
  await expect(redo).toBeDisabled();
  await expect.poll(async () => (await saved(page)).boards.at(-1).tiles).toEqual(original.tiles);
  const restored = await saved(page);
  expect(restored.boards.at(-1).id).toBe(original.id);
  expect(restored.boards.at(-1).revision).toBeGreaterThan(original.revision);
  expect(restored.boardLastPlayedAt[original.id]).toBe(recency);
});

test('newer direct edits merge with a pending request and conflicting fields require a choice', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/boards/propose', async route => {
    const input = route.request().postDataJSON(); await gate;
    await respond(route, { ...proposal(), title: 'AI title', tiles: input.board.tiles.map((t: any) => ({ ...word(t.label, t.id), speech: t.label === 'Cow' ? 'Hello cow' : t.speech })) });
  });
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await send(page, 'Change the title and cow speech');
  await expect(page.getByTestId('ai-working')).toBeVisible();
  await page.getByRole('textbox', { name: 'Board title' }).fill('My title');
  await page.getByRole('textbox', { name: 'Message to AI' }).fill('My next request');
  release();
  await expect(page.getByRole('button', { name: 'Keep my edits' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message to AI' })).toHaveValue('My next request');
  await page.getByRole('button', { name: 'Keep my edits' }).click();
  await expect(page.getByRole('button', { name: 'Keep my edits' })).toHaveCount(0);
  const board = (await saved(page)).boards[0];
  expect(board.title).toBe('My title'); expect(board.tiles[0].speech).toBe('Hello cow');
});

test('card handoff saves typed words and enforces scope even when AI changes the whole board', async ({ page }) => {
  let input: any;
  await page.route('**/api/boards/propose', route => {
    input = route.request().postDataJSON();
    return respond(route, { ...proposal(), title: 'Wrong title', tiles: input.board.tiles.map((t: any) => ({ ...word(t.label, t.id), speech: 'Moo moo' })).reverse() });
  });
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('textbox', { name: 'Words on the tile' }).fill('My cow');
  await page.getByRole('button', { name: 'Ask AI about this card' }).click();
  await expect(page.getByRole('textbox', { name: 'Message to AI' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Message to AI' })).toHaveAttribute('placeholder', /Say moo twice/);
  await send(page, 'Make its sound repeat');
  await waitForAiTurn(page);
  const board = (await saved(page)).boards[0];
  expect(input.board.tiles[0].label).toBe('My cow');
  expect(board.title).toBe('Farmyard friends'); expect(board.tiles[0].speech).toBe('Moo moo'); expect(board.tiles[1].speech).toBe('Sheep');
  await page.getByRole('button', { name: 'Edit tile My cow', exact: true }).click();
  await page.getByRole('button', { name: 'Remove tile', exact: true }).click();
  await send(page, 'Rename the board');
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue('Wrong title');
  expect(input.prompt).toBe('Rename the board');
});

test('stop ignores late replies and retry keeps the first generated board without a discard action', async ({ page }) => {
  const requests: any[] = []; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/boards/propose', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) { await gate; await respond(route, proposal('Wrong late word')).catch(() => {}); }
    else await respond(route);
  });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await send(page, 'A cow');
  await expect(page.getByTestId('ai-working')).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole('button', { name: 'Stop request' }).click();
  await expect(page.getByRole('textbox', { name: 'Message to AI' })).toHaveValue('A cow');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByTestId('editor-preview')).toContainText('Cow');
  release(); expect(requests[1].conversation.history).toEqual([]);
  await expect(page.getByTestId('editor-preview')).not.toContainText('Wrong late word');
  await expect(page.getByRole('button', { name: 'Dismiss', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo last AI change', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('editor-preview')).toContainText('Cow');
});

test('a new AI turn after partial Redo discards the remaining redo branch and preserves earlier work', async ({ page }) => {
  const requests: any[] = [];
  await page.route('**/api/pictures/analyze', route => route.fulfill({ status: 503, json: { error: 'Pictures unavailable' } }));
  await page.route('**/api/boards/propose', route => {
    const input = route.request().postDataJSON(); requests.push(input);
    return respond(route, requests.length === 1 ? { ...proposal(), tiles: [word('Cow'), word('Sheep')] } : { ...proposal(), tiles: input.board.tiles.map((tile: any) => ({ ...word(tile.label, tile.id), speech: tile.speech, color: 'sky' })) });
  });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await send(page, 'Cow and sheep');
  await waitForAiTurn(page);
  await expect(page.getByTestId('editor-preview')).toContainText('Sheep');
  await send(page, 'Make them blue');
  await waitForAiTurn(page);
  await page.getByRole('button', { name: 'Edit tile Sheep', exact: true }).click();
  await page.getByRole('textbox', { name: 'What it says', exact: true }).fill('My sheep');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await add(page, 'Water');
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('My next request');
  await page.getByRole('button', { name: 'Undo last board change', exact: true }).click();
  await expect(page.getByTestId('editor-preview')).toContainText('Cow');
  await expect(page.getByTestId('editor-preview')).toContainText('Sheep');
  await expect(page.getByTestId('editor-preview')).not.toContainText('Water');
  expect((await saved(page)).boards.at(-1).tiles[1].speech).toBe('My sheep');
  await page.getByRole('button', { name: 'Undo last board change', exact: true }).click();
  await expect.poll(async () => (await saved(page)).boards.at(-1).tiles[1].speech).toBe('Sheep');
  await page.getByRole('button', { name: 'Undo last board change', exact: true }).click();
  await expect.poll(async () => (await saved(page)).boards.at(-1).tiles[0].color).toBe('sage');
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toHaveValue('My next request');
  await expect(page.getByRole('button', { name: 'Undo last AI change', exact: true })).toHaveCount(0);
  const redo = page.getByRole('button', { name: 'Redo last board change', exact: true });
  await redo.click();
  await expect.poll(async () => (await saved(page)).boards.at(-1).tiles[0].color).toBe('sky');
  await expect(redo).toBeEnabled();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  await waitForAiTurn(page);
  await expect(redo).toBeDisabled();
  expect(requests[2].conversation.history).toHaveLength(2);
  expect(requests[2].board.tiles.map((tile: any) => tile.label)).toEqual(['Cow', 'Sheep']);
  expect(requests[2].board.tiles[0].color).toBe('sky');
  expect(requests[2].board.tiles[1].speech).toBe('Sheep');
});

test('failed follow-ups retain the saved board and retry text', async ({ page }) => {
  let n = 0;
  await page.route('**/api/boards/propose', route => ++n === 2 ? route.fulfill({ status: 502, json: { error: 'Please try again.' } }) : respond(route));
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await send(page, 'Cow');
  await waitForAiTurn(page);
  await send(page, 'Make it blue');
  await expect(page.getByText('Please try again.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('editor-preview')).toContainText('Cow');
  await expect(page.getByRole('textbox', { name: 'Message to AI' })).toHaveValue('Make it blue');
  await waitForAiTurn(page);
  await expect(page.getByRole('button', { name: 'Edit tile Cow', exact: true })).toBeVisible();
});

test('failed automatic save retains the result and retry creates exactly one board', async ({ page }) => {
  let release!: () => void; let received = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/boards/propose', async route => { received = true; await gate; await respond(route); });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await send(page, 'Cow');
  await expect.poll(() => received).toBe(true);
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args: any[]) { if ((window as any).__failWrites) throw new DOMException('Storage full', 'QuotaExceededError'); return put.apply(this, args as any); }; (window as any).__failWrites = true; });
  release();
  await expect(page.getByTestId('board-assistant')).toContainText('Storage full');
  expect((await saved(page)).boards).toHaveLength(3);
  await page.evaluate(() => { (window as any).__failWrites = false; });
  await page.getByRole('button', { name: 'Retry saving AI changes', exact: true }).click();
  await waitForAiTurn(page);
  await expect(page.getByRole('button', { name: 'Edit tile Cow', exact: true })).toBeVisible();
  expect((await saved(page)).boards).toHaveLength(4);
});

for (const outcome of ['failure', 'success'] as const) test(`browser navigation is guarded during a durable save through ${outcome}`, async ({ page }) => {
  let release!: () => void; let received = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/boards/propose', async route => { received = true; await gate; await respond(route); });
  await page.getByRole('button', { name: 'New board', exact: true }).click(); await send(page, 'Cow');
  await expect.poll(() => received).toBe(true);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) {
      const result = put.apply(this, args as any);
      if (this.name === 'state' && args[0]?.boards?.some((board: any) => board.title === 'Animal words') && !(window as any).__heldWrite) {
        (window as any).__heldWrite = true; let hold = true;
        const alive = () => { if (hold) this.get('library').onsuccess = alive; }; alive();
        (window as any).__releaseWrite = (fail: boolean) => { hold = false; if (fail) this.transaction.abort(); };
      } return result;
    };
  });
  release();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__releaseWrite))).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL(/#boards\/new$/);
  await expect(page.getByRole('button', { name: 'Boards', exact: true })).toBeDisabled();
  await page.evaluate(fail => (window as any).__releaseWrite(fail), outcome === 'failure');
  if (outcome === 'failure') { await expect(page.getByTestId('board-assistant')).toContainText(/abort/i); await page.getByRole('button', { name: 'Retry saving AI changes', exact: true }).click(); }
  await waitForAiTurn(page);
  await expect(page.getByRole('button', { name: 'Edit tile Cow', exact: true })).toBeVisible();
  expect((await saved(page)).boards).toHaveLength(4);
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await expect(page.getByRole('button', { name: /^(New board|Resume draft)$/ })).toBeVisible();
});

test('minimal example-led composer fits phones and tablets without suggestion pills or an info action', async ({ page }) => {
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Board options', exact: true })).toHaveCount(0);
  await expect(page.getByText('Editing language', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pictures', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Board settings', exact: true }).click();
  for (const name of ['Languages', 'Pictures', 'Duplicate board', 'Delete board']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Board settings', exact: true }).click();
  for (const size of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
    await page.setViewportSize(size);
    for (const name of ['Add card', 'Board settings', 'Send message', 'Play board']) await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('textbox', { name: 'Message to AI' })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `artifacts/screenshots/unified-editor-${size.width}.png` });
  }
  await expect(page.getByRole('button', { name: 'History', exact: true })).toHaveCount(0);
  await expect(page.getByText('Review before keeping', { exact: true })).toHaveCount(0);
  for (const name of ['About AI', 'Add a drink', 'Shorter words', 'Farm animals', 'Snack time']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toHaveAttribute('placeholder', /Add a water card/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/boards/propose', route => {
    const board = route.request().postDataJSON().board;
    return respond(route, { ...proposal(), title: board.title, tiles: board.tiles.map((tile: any) => ({ ...word(tile.label, tile.id), emoji: tile.emoji, color: tile.color, speech: tile.label === 'Cow' ? 'Moo moo' : tile.speech })) });
  });
  await send(page, 'Make the cow say moo moo');
  await waitForAiTurn(page);
  await expect(page.getByRole('button', { name: 'Undo last board change', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('textbox', { name: 'Message to AI' })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'artifacts/screenshots/unified-editor-suggestion-390.png' });
});

test('direct additions during a request survive and can be changed in the next AI turn', async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let turns = 0;
  await page.route('**/api/pictures/analyze', route => route.fulfill({ status: 503, json: { error: 'Pictures unavailable' } }));
  await page.route('**/api/boards/propose', async route => {
    const input = route.request().postDataJSON(); const turn = ++turns;
    if (turn === 1) await gate;
    await respond(route, { ...proposal(), title: 'Our board', tiles: input.board.tiles.map((t: any) => word(turn === 2 && t.label === 'Water' ? 'Drink' : t.label, t.id)) });
  });
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await send(page, 'Rename the board');
  await expect(page.getByTestId('ai-working')).toBeVisible();
  await add(page, 'Water');
  release();
  await waitForAiTurn(page);
  await expect(page.getByTestId('editor-preview')).toContainText('Water');
  await send(page, 'Call Water Drink');
  await expect(page.getByTestId('editor-preview')).toContainText('Drink');
  await waitForAiTurn(page);
  expect((await saved(page)).boards[0].tiles.at(-1).label).toBe('Drink');
});

test('typing in a reduced phone viewport keeps the prompt, send control, and board preview visible', async ({ page }) => {
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.route('**/api/boards/propose', route => respond(route, { ...proposal(), tiles: [word('Cow'), word('Sheep')] }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await send(page, 'Cow and sheep');
  await waitForAiTurn(page);
  const input = page.getByRole('textbox', { name: 'Message to AI', exact: true });
  for (const size of [{ width: 390, height: 430 }, { width: 720, height: 330 }]) {
    await input.fill('Make the cow say moo.\nKeep the sheep.\nUse short words.\nKeep their pictures.');
    await page.setViewportSize(size);
    await expect(input).toBeFocused();
    await expect(input).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('editor-preview')).toBeInViewport({ ratio: 1 });
    expect((await page.getByTestId('editor-preview').boundingBox())!.height).toBeGreaterThan(70);
    await expect(page.getByRole('button', { name: 'Board settings', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add a drink', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('editor-preview')).toContainText('Sheep');
    await page.screenshot({ path: `artifacts/screenshots/editor-typing-${size.width}.png` });
    await page.getByRole('button', { name: 'Done typing', exact: true }).click();
    await expect(input).not.toBeFocused();
    await expect(input).toHaveValue(/Keep their pictures/);
    await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
  }
});

test('editing route reloads and keyboard text never requests microphone access', async ({ page }) => {
  await page.evaluate(() => { Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { throw new Error('Unexpected microphone request'); } }); });
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI' }).fill('Cow and бабушка');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue('Farmyard friends');
  await expect(page.getByRole('button', { name: 'Voice prompt', exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('button', { name: /^(New board|Resume draft)$/ })).toBeVisible();
});
