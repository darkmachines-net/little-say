/** @file Covers the shared board workspace. Exercises negotiated fast drafts, visible fallback status, verified downloads, and saving during late image completion. */

import { expect, test } from '@playwright/test';
import { openExistingLibrary } from './existingLibrary';
import seeds from '../../apps/server/src/pictures/data/picture-seeds.json' with { type: 'json' };
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const evidence = 'artifacts/screenshots/preparation';
async function capture(page: import('@playwright/test').Page, name: string) {
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
  await writeFile(`${evidence}/manifest.json`, JSON.stringify({ baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), viewport: page.viewportSize(), scenario: 'Same two-card fixture; legacy vs prepared protocol with pending picture work. Deterministic mocked provider responses.', files: Object.fromEntries(['apps/mobile/src/services/useBoardAssistant.ts', 'apps/mobile/src/services/preparedPictures.ts', 'apps/mobile/dist/index.html', 'tests/web/preparation.spec.ts'].map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')])) }, null, 2));
}

test('legacy emoji drafts can be kept during picture work', async ({ page }) => {
  await page.route('**/api/health', route => route.fulfill({ json: { pictures: { version: 1 } } }));
  await page.route('**/api/boards/propose', route => route.fulfill({ json: { boardId: null, baseRevision: null, proposal: { title: 'Animals and machines', explanation: 'Here is your draft.', needsClarification: false, picturePolicy: { mode: 'auto', style: 'color', consistent: false }, tiles: [
    { existingId: null, label: 'Cow', speech: 'Cow', language: 'en-US', emoji: '🐄', color: 'sage' },
    { existingId: null, label: 'Excavator', speech: 'Excavator', language: 'en-US', emoji: '🚜', color: 'peach' },
  ] } } }));
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/pictures/analyze', async route => { await pending; await route.fulfill({ json: { tiles: [] } }).catch(() => {}); });
  try {
    await openExistingLibrary(page);
    await page.getByRole('button', { name: 'New board', exact: true }).click();
    await page.getByLabel('Message to AI', { exact: true }).fill('Cow and excavator');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Keep changes', exact: true })).toBeEnabled();
    await expect(page.getByTestId('board-assistant').getByText('Choosing pictures for your cards…', { exact: true })).toBeVisible();
    await capture(page, 'legacy-pending');
  } finally { release(); }
});

test('saves exactly the visible draft and cancels pending generation', async ({ page }) => {
  const seed = seeds['mulberry-806']; let batchId = ''; let cancelled = false; let polls = 0;
  await page.route('**/api/health', route => route.fulfill({ json: { pictures: { version: 1 }, preparation: { version: 1 } } }));
  await page.route('**/api/boards/propose', route => {
    const input = route.request().postDataJSON(); batchId = input.preparationId;
    return route.fulfill({ json: { boardId: null, baseRevision: null, proposal: { title: 'Animals and machines', explanation: 'Here is your draft.', needsClarification: false, picturePolicy: { mode: 'auto', style: 'color', consistent: false }, tiles: [
      { existingId: null, label: 'Cow', speech: 'Cow', language: 'en-US', emoji: '🐄', color: 'sage' },
      { existingId: null, label: 'Excavator', speech: 'Excavator', language: 'en-US', emoji: '🚜', color: 'peach' },
    ] }, preparation: { id: batchId, state: 'working', tiles: [{ index: 0, state: 'ready', result: { kind: 'generated', assetId: seed.digest, description: 'cow', model: 'fixture', style: 'color' } }, { index: 1, state: 'generating' }] } } });
  });
  await page.route('**/api/pictures/assets/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(seed.png, 'base64') }));
  await page.route('**/api/pictures/batches/**', async route => {
    if (route.request().url().endsWith('/cancel')) { cancelled = true; await route.fulfill({ json: {} }); return; }
    polls++; await route.fulfill({ json: { id: batchId, state: 'working', tiles: [{ index: 0, state: 'ready' }, { index: 1, state: 'generating' }] } });
  });
  await openExistingLibrary(page);
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByLabel('Message to AI', { exact: true }).fill('Cow and excavator');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('card-picture')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep changes', exact: true })).toBeEnabled();
  await expect(page.getByText('Generating illustration', { exact: true })).toBeVisible();
  await capture(page, 'prepared-pending');
  await page.getByRole('button', { name: 'Keep changes', exact: true }).click();
  await expect.poll(() => cancelled).toBe(true);
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const open = indexedDB.open('little-say'); open.onsuccess = () => resolve(open.result); });
    const library = await new Promise<any>(resolve => { const read = db.transaction('state').objectStore('state').get('library'); read.onsuccess = () => resolve(read.result); }); db.close(); return library;
  });
  const board = saved.boards.find((board: any) => board.title === 'Animals and machines');
  expect(board.tiles[0].illustration.assetId).toBe(seed.digest); expect(board.tiles[1].illustration.kind).toBe('emoji');
  const stopped = polls; await page.waitForTimeout(800); expect(polls).toBe(stopped);
});
