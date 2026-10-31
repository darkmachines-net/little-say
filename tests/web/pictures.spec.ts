/** @file Verifies saved picture turns, stopped results, fallback, and offline images with device voices isolating picture work. */

import { test, expect, type Page } from '@playwright/test';
import { waitForAiTurn, openBoardPictures } from './boardEditor';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { openExistingLibrary } from './existingLibrary';
import { type BoardProposal, type PictureJobRequest, type ResolvedPicture } from '@little-say/core';

const policy = { mode: 'auto' as const, style: 'color' as const, consistent: true };
const labels = ['Dump truck', 'Concrete truck', 'Excavator', 'Bulldozer', 'Crane truck', 'Road roller'];
const draft = (): BoardProposal => ({ boardId: null, baseRevision: null, proposal: { title: 'Construction vehicles', explanation: 'Six distinct construction vehicles.', needsClarification: false, picturePolicy: policy, tiles: labels.map((label, index) => ({ existingId: null, label, speech: label, language: 'en-US', emoji: index < 2 ? '🚚' : '🚜', color: 'sage' })) } });
async function library(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const value = await new Promise<any>(resolve => { const request = db.transaction('state').objectStore('state').get('library'); request.onsuccess = () => resolve(request.result); }); db.close(); return value;
  });
}
async function mockPictures(page: Page, pending = false) {
  const jobs: PictureJobRequest[] = []; const cancelled: string[] = [];
  const ready = new Set<string>();
  const images = await Promise.all(labels.map(async (_label, index) => {
    const bytes = await sharp({ create: { width: 128, height: 128, channels: 4, background: ['#ea7730', '#8194df', '#85b083', '#cebe6e', '#dc98b9', '#84cdd8'][index] } }).png().toBuffer();
    return { bytes, id: createHash('sha256').update(bytes).digest('hex') };
  }));
  await page.route('**/api/pictures/analyze', route => { const input = route.request().postDataJSON(); return route.fulfill({ json: { tiles: input.tiles.map((tile: any) => ({ id: tile.id, emoji: tile.emoji || '🚜', concept: { description: tile.label, features: ['distinct structure'], searchTerms: [tile.label], emojiAccurate: false } })) } }); });
  await page.route('**/api/pictures/jobs', route => {
    const input = route.request().postDataJSON() as PictureJobRequest; jobs.push(input);
    const index = Math.max(0, labels.indexOf(input.concept.description));
    return route.fulfill({ json: { id: input.requestId, draftId: input.draftId, tileId: input.tileId, state: pending ? 'working' : 'complete', result: pending ? undefined : { kind: 'generated', assetId: images[index].id, style: input.style, description: input.concept.description, model: 'mock' } } });
  });
  await page.route('**/api/pictures/jobs/*', route => { const id = route.request().url().split('/').at(-1)!; const input = jobs.find(job => job.requestId === id)!; const image = images[Math.max(0, labels.indexOf(input.concept.description))]; return route.fulfill({ json: { id, draftId: input.draftId, tileId: input.tileId, state: ready.has(input.concept.description) ? 'complete' : 'working', result: ready.has(input.concept.description) ? { kind: 'generated', assetId: image.id, style: input.style, description: input.concept.description, model: 'mock' } : undefined } }); });
  await page.route('**/api/pictures/jobs/*/cancel', route => { const id = route.request().url().split('/').at(-2)!; cancelled.push(id); return route.fulfill({ json: { id, draftId: 'cancelled', tileId: 'cancelled', state: 'cancelled' } }); });
  await page.route('**/api/pictures/assets/*.png', route => {
    const found = images.find(image => route.request().url().endsWith(`${image.id}.png`));
    return found ? route.fulfill({ body: found.bytes, contentType: 'image/png' }) : route.fulfill({ status: 404 });
  });
  await page.route('**/api/pictures/review', route => route.fulfill({ json: { rejected: [] } }));
  return { jobs, cancelled, images, ready };
}
test.beforeEach(async ({ page }) => { await openExistingLibrary(page, { voiceSources: { 'en-US': 'device', 'ru-RU': 'device' } }); });

test('a complete emoji board is ready to save without suggesting AI illustrations', async ({ page }) => {
  const { jobs } = await mockPictures(page);
  const proposal = draft();
  const animals = ['Cow', 'Sheep', 'Horse', 'Pig', 'Chicken', 'Goat'];
  proposal.proposal.title = 'Farm animals';
  proposal.proposal.tiles = proposal.proposal.tiles.map((tile, index) => ({ ...tile, label: animals[index], speech: animals[index], emoji: ['🐄', '🐑', '🐎', '🐖', '🐔', '🐐'][index] }));
  await page.route('**/api/boards/propose', route => route.fulfill({ json: proposal }));
  await page.route('**/api/pictures/analyze', route => { const input = route.request().postDataJSON(); return route.fulfill({ json: { tiles: input.tiles.map((tile: any) => ({ id: tile.id, emoji: tile.emoji, concept: { description: tile.label, features: [], searchTerms: [tile.label], emojiAccurate: true } })) } }); });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Six farm animals');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await waitForAiTurn(page);
  await expect(page.getByRole('button', { name: 'Create matching AI illustrations', exact: true })).toHaveCount(0);
  await expect(page.getByText(/A matching set of AI illustrations/)).toHaveCount(0);
  expect(jobs).toHaveLength(0);
  await waitForAiTurn(page);
  expect((await library(page)).boards.at(-1).tiles.map((tile: any) => tile.label)).toEqual(animals);
});

test('Automatic fills gaps and explicit picture restyling stages changes with cancel and apply', async ({ page }) => {
  const { jobs } = await mockPictures(page);
  const proposal = draft();
  proposal.proposal.tiles = proposal.proposal.tiles.slice(0, 3).map((tile, index) => ({ ...tile, label: ['Cow', 'Sheep', 'Excavator'][index], speech: ['Cow', 'Sheep', 'Excavator'][index], emoji: ['🐄', '🐑', '🚜'][index] }));
  await page.route('**/api/boards/propose', route => route.fulfill({ json: proposal }));
  await page.route('**/api/pictures/analyze', route => { const input = route.request().postDataJSON(); return route.fulfill({ json: { tiles: input.tiles.map((tile: any) => ({ id: tile.id, emoji: tile.emoji || '🚜', concept: { description: tile.label, features: [], searchTerms: [tile.label], emojiAccurate: tile.label !== 'Excavator' } })) } }); });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Cow, sheep, and excavator');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('editor-preview').getByTestId('card-picture')).toHaveCount(1);
  await expect(page.getByTestId('ai-working')).toHaveCount(0);
  expect(jobs.map(job => job.concept.description)).toEqual(['Excavator']);
  const restyle = async () => {
    await openBoardPictures(page);
    await page.getByRole('button', { name: 'Picture source: Automatic', exact: true }).click();
    await page.getByRole('button', { name: 'AI illustrations', exact: true }).click();
    await page.getByRole('button', { name: 'Restyle board', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Apply pictures', exact: true })).toBeEnabled();
  };
  await restyle();
  await page.getByRole('button', { name: 'Close Board pictures', exact: true }).click();
  await expect(page.getByTestId('editor-preview').getByTestId('card-picture')).toHaveCount(1);
  await restyle();
  await page.getByRole('button', { name: 'Apply pictures', exact: true }).click();
  await expect(page.getByTestId('editor-preview').getByTestId('card-picture')).toHaveCount(3);
  expect(jobs.slice(1).every(job => job.mode === 'generated')).toBe(true);
  expect((await library(page)).boards).toHaveLength(4);
  await waitForAiTurn(page);
  expect((await library(page)).boards.at(-1).picturePolicy.mode).toBe('generated');
});

test('construction pictures are generated, saved automatically offline, and retained in later text edits', async ({ page, context }) => {
  const { jobs } = await mockPictures(page);
  await page.route('**/api/boards/propose', route => route.fulfill({ json: draft() }));
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Six construction vehicles, with clear pictures.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();

  await expect(page.getByTestId('editor-preview').getByTestId('card-picture')).toHaveCount(6);
  await waitForAiTurn(page);
  expect(jobs).toHaveLength(6); expect(jobs.every(job => job.allowGeneration)).toBe(true);
  expect((await library(page)).boards.some((board: any) => board.title === 'Construction vehicles')).toBe(true);
  await expect.poll(async () => (await library(page)).boards.at(-1).tiles.filter((tile: any) => tile.illustration.kind === 'generated').length).toBe(6);
  await page.reload();
  await expect(page.getByTestId('editor-preview').getByTestId('card-picture')).toHaveCount(6);
  expect(jobs).toHaveLength(6);
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshots/pictures-draft.png' });
  await waitForAiTurn(page);
  const stored = (await library(page)).boards.at(-1);
  expect(new Set(stored.tiles.map((tile: any) => tile.illustration.assetId)).size).toBe(6);
  expect((await library(page)).settings.autoImages).not.toBe(true);
  await page.unroute('**/api/boards/propose');
  await page.route('**/api/boards/propose', route => route.fulfill({ json: { boardId: stored.id, baseRevision: stored.revision, proposal: { ...draft().proposal, title: 'Our vehicles', tiles: stored.tiles.map((tile: any) => ({ existingId: tile.id, label: tile.label, speech: tile.speech, language: tile.language, color: tile.color, emoji: '' })) } } }));

  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Rename the board only.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await waitForAiTurn(page);
  expect(jobs).toHaveLength(6);
  expect((await library(page)).boards.at(-1).tiles.map((tile: any) => tile.illustration)).toEqual(stored.tiles.map((tile: any) => tile.illustration));
  await page.getByRole('button', { name: 'Play board', exact: true }).click();
  await expect(page.getByTestId('card-picture')).toHaveCount(6);
  await context.setOffline(true); await page.reload(); await expect(page.getByTestId('card-picture')).toHaveCount(6);
  await expect(page.getByText('Picture unavailable', { exact: true })).toHaveCount(0);
});

test('stopping picture jobs saves the usable board without a separate acceptance step', async ({ page }) => {
  const { jobs, cancelled, ready } = await mockPictures(page, true);
  await page.route('**/api/boards/propose', route => route.fulfill({ json: draft() }));
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Construction vehicles');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => jobs.length).toBe(2);
  ready.add(labels[1]);
  await expect(page.getByTestId('editor-preview').getByTestId('card-picture')).toHaveCount(1);
  await expect.poll(() => jobs.length).toBe(3);
  await page.getByRole('button', { name: 'Stop request', exact: true }).click();
  await expect.poll(() => cancelled.length).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('picture-active-animation')).toHaveCount(0);
  await expect(page.getByTestId('editor-preview').getByTestId('card-picture')).toHaveCount(1);
  await waitForAiTurn(page);
  labels.forEach(label => ready.add(label));
  await expect(page.getByRole('button', { name: 'Dismiss', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('editor-preview').getByRole('button')).toHaveCount(6);
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  expect((await library(page)).boards).toHaveLength(4);
  await page.getByRole('button', { name: 'Edit Construction vehicles', exact: true }).click();
  await expect(page.getByTestId('editor-preview').getByTestId('card-picture')).toHaveCount(1);
  await expect(page.getByTestId('editor-preview').getByRole('button')).toHaveCount(6);
});

test('manual library selection needs no AI permission and saves attribution plus a protected offline picture', async ({ page, context }) => {
  const { images, jobs } = await mockPictures(page);
  const provenance = { library: 'mulberry', sourceId: 'cow', sourceUrl: 'https://mulberrysymbols.org/', author: 'Mulberry Symbols by Steve Lee', license: 'CC-BY-SA-4.0', modified: 'Rasterized with padding.' };
  const picture: ResolvedPicture = { kind: 'library', assetId: images[0].id, style: 'color', provenance: provenance as any };
  await page.route('**/api/pictures/search?*', route => route.fulfill({ json: { entries: [{ id: 'mulberry-cow', name: 'Cow picture', terms: ['cow'], style: 'color', provenance }] } }));
  await page.route('**/api/pictures/library/*', route => route.fulfill({ json: { picture } }));
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('button', { name: 'Picture options', exact: true }).click();
  await page.getByRole('button', { name: 'Search pictures', exact: true }).click();
  await page.getByRole('button', { name: 'Cow picture', exact: true }).click();
  await expect(page.getByText(/Mulberry Symbols by Steve Lee · CC-BY-SA-4.0/)).toBeVisible();
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  const saved = (await library(page)).boards[0].tiles[0]; expect(saved.illustration).toEqual(picture); expect(saved.pictureOptions.locked).toBe(true); expect(jobs).toHaveLength(0);
  await context.setOffline(true); await page.reload();
  if (!page.url().includes('/edit')) await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click(); await expect(page.getByTestId('card-picture')).toHaveCount(1);
});

test('board restyling previews changes, preserves a protected card, and supports returning to emoji', async ({ page }) => {
  const { jobs } = await mockPictures(page);
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('button', { name: 'Picture options', exact: true }).click();
  await page.getByRole('switch', { name: 'Keep this picture', exact: true }).check();
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await openBoardPictures(page);
  await page.getByRole('button', { name: 'Restyle board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply pictures', exact: true })).toBeEnabled();
  expect(jobs).toHaveLength(5); expect(jobs.every(job => job.style === 'color')).toBe(true);
  expect((await library(page)).boards[0].tiles.every((tile: any) => tile.illustration.kind === 'emoji')).toBe(true);
  await page.getByRole('button', { name: 'Apply pictures', exact: true }).click();
  await expect(page.getByTestId('card-picture')).toHaveCount(5);
  const saved = (await library(page)).boards[0];
  expect(saved.picturePolicy.style).toBe('color'); expect(saved.tiles[0].illustration).toEqual({ kind: 'emoji', emoji: '🐄' });
  await openBoardPictures(page);
  await page.getByRole('button', { name: 'Picture source: Automatic', exact: true }).click();
  await page.getByRole('button', { name: 'Emoji only', exact: true }).click();
  await page.getByRole('button', { name: 'Restyle board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply pictures', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Apply pictures', exact: true }).click();
  await expect(page.getByTestId('card-picture')).toHaveCount(0);
  expect(jobs).toHaveLength(5);
  expect((await library(page)).boards[0].picturePolicy.mode).toBe('emoji');
});

test('picture sources use a compact explained selector with keyboard dismissal and no duplicate generation gate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await openBoardPictures(page);
  const source = page.getByRole('button', { name: 'Picture source: Automatic', exact: true });
  await expect(source).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Library only', exact: true })).toHaveCount(0);
  await expect(page.getByText('Illustration style', { exact: true })).toHaveCount(0);
  await source.press('Enter');
  await expect(source).toHaveAttribute('aria-expanded', 'true');
  const labels = ['Automatic', 'Library only', 'AI illustrations', 'Emoji only'];
  const boxes = await Promise.all(labels.map(label => page.getByRole('button', { name: label, exact: true }).boundingBox()));
  expect(boxes.every((box, index) => box && box.x === boxes[0]!.x && box.width === boxes[0]!.width && (index === 0 || box.y >= boxes[index - 1]!.y + boxes[index - 1]!.height))).toBe(true);
  await expect(page.getByText('Use free library pictures, with emoji when there is no good match. Never generate new images.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Library only', exact: true }).press('Escape');
  await expect(source).toHaveAttribute('aria-expanded', 'false'); await expect(source).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Board pictures', exact: true })).toBeVisible();
  await source.click(); await page.getByRole('button', { name: 'Library only', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Picture source: Library only', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Emoji only', exact: true })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Allow AI pictures', exact: true })).toHaveCount(0);
});

test('card source choices show their inherited value and can return to following the board', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('button', { name: 'Picture options', exact: true }).click();
  await page.getByRole('button', { name: 'Picture source for this card: Follow board · Automatic', exact: true }).click();
  await page.getByRole('button', { name: 'Emoji only', exact: true }).click();
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  expect((await library(page)).boards[0].tiles[0].pictureOptions.mode).toBe('emoji');
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('button', { name: 'Picture options', exact: true }).click();
  await page.getByRole('button', { name: 'Picture source for this card: Emoji only', exact: true }).click();
  await page.getByRole('button', { name: 'Follow board · Automatic', exact: true }).click();
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  expect((await library(page)).boards[0].tiles[0].pictureOptions.mode).toBeUndefined();
});

test('full-page canvas streams finished pictures, distinguishes active and queued work, and keeps settings accessible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const { jobs, ready } = await mockPictures(page, true);
  await page.route('**/api/boards/propose', route => route.fulfill({ json: draft() }));
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await expect(page).toHaveURL(/#boards\/new$/);
  await expect(page.getByTestId('modal-backdrop')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Six construction vehicles');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();

  await expect.poll(() => jobs.length).toBe(2);
  await expect(page.getByTestId('picture-active-animation')).toHaveCount(2);
  await expect(page.getByTestId('editor-preview').getByText('Queued', { exact: true })).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Board settings', exact: true })).toBeEnabled();
  const chat = (await page.getByTestId('editor-actions').boundingBox())!;
  const canvas = (await page.getByTestId('editor-preview').boundingBox())!;
  expect(chat.x).toBeGreaterThanOrEqual(canvas.x + canvas.width);
  const before = await page.getByTestId('picture-active-animation').first().evaluate(element => getComputedStyle(element).opacity);
  await expect.poll(() => page.getByTestId('picture-active-animation').first().evaluate(element => getComputedStyle(element).opacity)).not.toBe(before);
  const cycles = await page.getByTestId('picture-active-animation').first().evaluate(async element => {
    const ranges: number[][] = [[], []]; const start = performance.now();
    while (performance.now() - start < 3600) { ranges[Math.min(1, Math.floor((performance.now() - start) / 1800))].push(Number(getComputedStyle(element).opacity)); await new Promise(requestAnimationFrame); }
    return ranges.map(frames => Math.max(...frames) - Math.min(...frames));
  });
  expect(cycles.every(range => range > 0.3)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByTestId('picture-active-animation').first()).toHaveCSS('opacity', '0.45');
  const reducedFrames = await page.getByTestId('picture-active-animation').first().evaluate(async element => {
    const frames: string[] = []; const start = performance.now();
    while (performance.now() - start < 1800) { frames.push(getComputedStyle(element).opacity); await new Promise(requestAnimationFrame); }
    return [...new Set(frames)];
  });
  expect(reducedFrames).toEqual(['0.45']);
  ready.add(labels[1]);
  await expect(page.getByTestId('editor-preview').getByTestId('card-picture')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Edit tile Concrete truck, suggested change', exact: true })).toContainText('Ready');
  await expect(page.getByRole('button', { name: 'Edit tile Dump truck, suggested change', exact: true })).toContainText('Improving picture');
  await expect.poll(() => jobs.length).toBe(3);
  expect((await library(page)).boards.some((board: any) => board.title === 'Construction vehicles')).toBe(false);
  await expect(page.getByRole('button', { name: 'Keep changes', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop request', exact: true }).click();
  await waitForAiTurn(page);
  await openBoardPictures(page);
  await page.getByRole('button', { name: 'Picture source: Automatic', exact: true }).click();
  await page.getByRole('button', { name: 'Emoji only', exact: true }).click();
  await page.getByRole('button', { name: 'Improve pictures', exact: true }).click();
  await page.getByRole('button', { name: 'Apply pictures', exact: true }).click();
  await expect(page.getByTestId('editor-preview').getByTestId('card-picture')).toHaveCount(0);
  await expect(page.getByTestId('picture-active-animation')).toHaveCount(0);
  expect(jobs).toHaveLength(3);
  await page.goBack();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
});

test('missing library and disabled server generation keep a usable emoji board with one summary', async ({ page, context }) => {
  const { jobs } = await mockPictures(page);
  await page.route('**/api/pictures/jobs', route => { const input = route.request().postDataJSON(); jobs.push(input); return route.fulfill({ json: { id: input.requestId, draftId: input.draftId, tileId: input.tileId, state: 'complete', result: { kind: 'unresolved', reason: 'No clear library match. Enable AI pictures.' } } }); });
  await page.route('**/api/boards/propose', route => route.fulfill({ json: draft() }));
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('Construction vehicles');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();

  await waitForAiTurn(page);
  await expect(page.getByTestId('picture-summary')).toHaveCount(1);
  await expect(page.getByTestId('picture-summary')).toContainText('closest emoji for 6 cards');
  await expect(page.getByText(/Enable AI pictures|Needs a picture|No clear library match/)).toHaveCount(0);
  await waitForAiTurn(page);
  expect((await library(page)).boards.at(-1).tiles.every((tile: any) => tile.illustration.kind === 'emoji')).toBe(true);
  await page.getByRole('button', { name: 'Play board', exact: true }).click();
  const continueToBoard = page.getByRole('button', { name: 'Continue to board', exact: true });
  if (await continueToBoard.isVisible()) await continueToBoard.click();
  await expect(page.getByTestId('play-board')).toBeVisible();
  await expect.poll(async () => (await library(page)).settings.activeBoardId).not.toBeNull();
  await context.setOffline(true); await page.reload();
  for (const label of labels) await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
});

for (const [mode, label] of [['library', 'Library only'], ['emoji', 'Emoji only']] as const) test(`board choices retain inherited ${label} and explicit overrides after default migration`, async ({ page }) => {
  const value = await library(page);
  value.settings.pictureDefaults = { ...policy, mode: 'generated' };
  value.boards[0].picturePolicy = { ...policy, mode };
  const seed = async () => {
    await page.evaluate(async value => {
      const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
      await new Promise<void>(resolve => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(value, 'library'); tx.oncomplete = () => resolve(); }); db.close();
    }, value);
    await page.reload();
  if (!page.url().includes('/edit')) await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
    await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
    await page.getByRole('button', { name: 'Picture options', exact: true }).click();
  };
  await seed();
  const follow = page.getByRole('button', { name: new RegExp('Picture source for this card: Follow board.*' + label) });
  await expect(follow).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate new picture', exact: true })).toBeDisabled();
  await follow.click();
  await page.getByRole('button', { name: 'AI illustrations', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate new picture', exact: true })).toBeEnabled();
  value.boards[0].picturePolicy = { ...policy, mode: 'generated' };
  await seed();
  await expect(page.getByRole('button', { name: /Picture source for this card: Follow board.*AI illustrations/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate new picture', exact: true })).toBeEnabled();
});

for (const action of ['close', 'stop', 'apply'] as const) test(`saved tile edits survive automatic picture ${action}`, async ({ page }) => {
  const value = await library(page); value.settings.aiConsent = true; value.settings.autoSpeech = false;
  await page.evaluate(async value => { const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); }); await new Promise<void>(resolve => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(value, 'library'); tx.oncomplete = () => resolve(); }); db.close(); }, value);
  await page.reload();
  const { jobs, cancelled } = await mockPictures(page, action !== 'apply');
  await page.getByRole('button', { name: 'Edit Farmyard friends', exact: true }).click();
  await page.getByRole('button', { name: 'Edit tile Cow', exact: true }).click();
  await page.getByRole('textbox', { name: 'Words on the tile', exact: true }).fill('Calf');
  await page.getByRole('button', { name: 'Save tile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Board pictures', exact: true })).toBeVisible();
  await expect.poll(() => jobs.length).toBeGreaterThan(0);
  if (action === 'apply') { await page.getByRole('button', { name: 'Apply pictures', exact: true }).click(); }
  else { if (action === 'stop') await page.getByRole('button', { name: 'Stop pictures', exact: true }).click(); await page.getByRole('button', { name: 'Close Board pictures', exact: true }).click(); await expect.poll(() => cancelled.length).toBeGreaterThan(0); }
  await expect(page.getByRole('button', { name: 'Edit tile Calf', exact: true })).toBeVisible();
  await expect.poll(async () => (await library(page)).boards[0].tiles[0].label).toBe('Calf');
  const saved = (await library(page)).boards[0];
  expect(saved.tiles[0].speech).toBe('Calf');
  expect(saved.revision).toBe(value.boards[0].revision + (action === 'apply' ? 2 : 1));
  expect(saved.tiles[0].illustration.kind).toBe(action === 'apply' ? 'generated' : 'emoji');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit tile Calf', exact: true })).toBeVisible();
});
