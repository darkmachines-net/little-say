/**
 * @file Runs billable browser benchmarks from Send through six suitable, decoded pictures and an
 * enabled save action. Build first, then run `npm run eval:boards -- --samples 100`.
 *
 * Each request uses fresh browser storage. Cold requests get separate empty reuse caches with bundled
 * assets available; warm requests share a cache after one warmup per fixture; concurrent requests use
 * four sessions and an initially empty shared cache. Browser sign-in uses synthetic metadata and CSRF,
 * never a real Firebase account; the isolated benchmark API measures provider work without account persistence.
 * `--conditions cold,warm,concurrent` selects populations; `--fixtures` selects fixture families.
 *
 * Drafting is billable. New artwork requires `--generate`; add `--unseeded` to bypass generated seeds.
 * For fresh construction art: `--fixtures construction --samples 1 --conditions cold --generate
 * --unseeded --timeout 120000`. No paid request is retried automatically. Only this isolated test
 * server's per-IP request limit is raised; deployment limits are unchanged.
 *
 * Ignored artifacts/board-preparation/ runs contain an immutable web copy, source/build hashes,
 * results, summary, screenshots and content-free model metrics. HTTP failures end a sample immediately;
 * failures and unsuitable fallbacks remain in the denominator. Missing provider usage stays unknown.
 * Asset-download time sums concurrent resource durations, so it must not be added to readiness time.
 * The exit status fails on any unsuitable request or p95 >= 10 seconds. Visual acceptance, fresh-art
 * latency, speech downloads, larger boards and deployment-network performance require separate checks.
 */

import { chromium, type Browser } from '@playwright/test';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadDevelopmentEnv, withDevelopmentApiKey } from './dev-config';
import { createServer } from '../apps/server/src/app';
import { openAIProvider } from '../apps/server/src/provider';
import { type DraftMetric } from '../apps/server/src/draft-diagnostics';
import { openAIPictureProvider } from '../apps/server/src/pictures/provider';
import { PictureJobs } from '../apps/server/src/pictures/jobs';
import { GenericContent } from '../apps/server/src/generic-content';
import { BoardPreparation } from '../apps/server/src/board-preparation';
import { starterLibrary } from '../tests/fixtures/library';
import { type BoardProposal } from '@little-say/core';

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const samples = Number(arg('--samples', '100'));
const timeout = Number(arg('--timeout', '45000'));
if (!Number.isInteger(samples) || samples < 1 || samples > 1000 || !Number.isFinite(timeout) || timeout < 1000) throw new Error('Invalid benchmark limits.');
const conditions = arg('--conditions', 'cold,warm,concurrent').split(',');
if (conditions.some(value => !['cold', 'warm', 'concurrent'].includes(value))) throw new Error('Unknown cache condition.');
const fixtures = [
  { id: 'farm', words: ['cow', 'sheep', 'horse', 'rabbit', 'chicken', 'duck'], prompt: 'Make six farm animal cards: cow, sheep, horse, rabbit, chicken, duck.' },
  { id: 'food', words: ['apple', 'banana', 'pear', 'bread', 'milk', 'water'], prompt: 'Make six food cards: apple, banana, pear, bread, milk, water.' },
  { id: 'household', words: ['chair', 'table', 'spoon', 'toilet', 'bed', 'cup'], prompt: 'Make six household object cards: chair, table, spoon, toilet, bed, cup.' },
  { id: 'routines', words: ['wash hands', 'brush teeth', 'eat', 'drink', 'sleep', 'use toilet'], prompt: 'Make six routine cards: wash hands, brush teeth, eat, drink, sleep, use toilet.' },
  { id: 'construction', words: ['dump truck', 'concrete mixer truck', 'excavator', 'bulldozer', 'crane truck', 'road roller'], prompt: 'Make six construction vehicle cards: dump truck, concrete mixer truck, excavator, bulldozer, crane truck, road roller.' },
];
const selected = arg('--fixtures', '').split(',').filter(Boolean);
const cases = selected.length ? fixtures.filter(value => selected.includes(value.id)) : fixtures;
if (!cases.length) throw new Error('No fixtures selected.');
const env = await withDevelopmentApiKey(await loadDevelopmentEnv(resolve('.')));
const directory = resolve('artifacts/board-preparation', `${Date.now()}-${randomUUID().slice(0, 8)}`);
await mkdir(directory, { recursive: true });
const webRoot = join(directory, 'web');
await cp(resolve('apps/mobile/dist'), webRoot, { recursive: true });
const sourceFiles = ['packages/core/src/schema.ts', 'packages/core/src/pictures.ts', 'apps/server/src/provider.ts', 'apps/server/src/pictures/provider.ts', 'apps/server/src/board-preparation.ts', 'apps/server/src/generic-content.ts', 'apps/server/src/generic-concepts.ts', 'apps/server/src/picture-scheduler.ts', 'apps/server/src/pictures/data/picture-seeds.json', 'apps/server/src/pictures/data/generated-picture-seeds.json', 'apps/mobile/src/services/preparedPictures.ts', 'apps/mobile/src/services/api.ts', 'apps/mobile/src/ui/AiConversation.tsx', 'apps/mobile/dist/index.html', 'scripts/benchmark-board-preparation.ts'];
await writeFile(join(directory, 'manifest.json'), JSON.stringify({ startedAt: new Date().toISOString(), baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fixtures: cases.map(item => item.id), generation: process.argv.includes('--generate'), generatedSeeds: !process.argv.includes('--unseeded'), files: Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(resolve(file))).digest('hex')]))) }, null, 2));
type Event = { operation: string; milliseconds?: number; count?: number; cacheHit?: boolean; inputTokens?: number; outputTokens?: number } & Partial<Pick<DraftMetric, 'requestId' | 'outcome' | 'stage' | 'failure'>>;
type Result = { condition: string; fixture: string; requestId?: string; httpStatus?: number; draftMs: number | null; readyMs: number; suitable: boolean; contentValid: boolean; templateHit: boolean; pictures: number; assetDownloadMs: number; error?: string };
const results: Result[] = [];
const events: (Event & { condition: string; namespace: string; source: string; at: string })[] = [];
async function server(condition: string, namespace: string) {
  const cache = join(directory, namespace);
  const metric = (source: string) => (event: Event) => { events.push({ condition, namespace, source, at: new Date().toISOString(), ...event }); };
  const provider = openAIProvider(env, metric('provider'));
  if (!provider) throw new Error('Configure an API key for this billable benchmark.');
  const pictures = new PictureJobs(join(cache, 'pictures'), openAIPictureProvider(env, metric('pictures')), process.argv.includes('--generate'));
  if (process.argv.includes('--unseeded')) pictures.generatedSeed = async () => null;
  const preparation = new BoardPreparation(join(cache, 'batches'), provider, pictures, new GenericContent(join(cache, 'generic')), undefined, 6, metric('preparation'));
  const origins: string[] = [];
  const app = await createServer({ provider, preparation, pictures, origins, aiRequestsPerMinute: 10000, webRoot });
  const url = await app.listen({ host: '127.0.0.1', port: 0 }); origins.push(url);
  return { app, url };
}
async function pageFor(browser: Browser, url: string) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.route('**/api/account/csrf', route => route.fulfill({ json: { csrfToken: 'benchmark-only' } }));
  await page.goto(url + '/app');
  await page.getByRole('heading', { name: 'Welcome to Little Say', exact: true }).waitFor();
  await page.evaluate(async library => {
    localStorage.setItem('little-say-firebase-account', JSON.stringify({ account: { id: '00000000-0000-4000-8000-000000000001', email: 'benchmark@example.test', displayName: 'Benchmark', emailVerified: false, providers: ['password'] },
      server: location.origin, firebaseUid: 'benchmark', authConfig: { projectId: 'demo-benchmark', apiKey: 'fixture', appId: 'fixture', authDomain: 'localhost', providers: ['password'] } }));
    const db = await new Promise<IDBDatabase>(resolve => { const opening = indexedDB.open('little-say'); opening.onsuccess = () => resolve(opening.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(library, 'library'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, starterLibrary());
  await page.reload();
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  return { context, page };
}
async function measure(browser: Browser, url: string, condition: string, fixture: typeof fixtures[number], capture = false) {
  const { context, page } = await pageFor(browser, url);
  let draftMs: number | null = null; let proposal: BoardProposal | undefined;
  let requestId: string | undefined; let httpStatus: number | undefined;
  let requestFailed!: (value: 'request-error') => void;
  const failedResponse = new Promise<'request-error'>(resolve => { requestFailed = resolve; });
  let started = Date.now();
  page.on('request', request => { if (request.url().endsWith('/api/boards/propose')) requestId = request.postDataJSON()?.preparationId; });
  page.on('response', response => { if (response.url().endsWith('/api/boards/propose')) {
    httpStatus = response.status(); draftMs = Date.now() - started;
    if (!response.ok()) requestFailed('request-error');
    else void response.json().then(value => { proposal = value; }).catch(() => requestFailed('request-error'));
  } });
  let suitable = false; let error: string | undefined;
  try {
    await page.getByLabel('Message to AI', { exact: true }).fill(fixture.prompt);
    started = Date.now();
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const outcome = await Promise.race([failedResponse, page.waitForFunction(() => {
      const cards = [...document.querySelectorAll('[data-testid^="draft-card-"]')];
      const save = [...document.querySelectorAll('[role="button"],button')].find(button => button.textContent === 'Use this board');
      if (cards.length !== 6 || !save || save.getAttribute('aria-disabled') === 'true') return false;
      // These fixtures all have raster seeds. Wait for each actual image, not just ready metadata.
      if (cards.every(card => card.getAttribute('aria-label')?.endsWith(': Ready') && (() => {
        const image = card.querySelector<HTMLImageElement>('[data-testid="card-picture"] img');
        return image?.complete && image.naturalWidth > 0;
      })())) return 'ready';
      if (cards.some(card => /: (Using emoji|Kept picture)$/.test(card.getAttribute('aria-label') ?? '')) && cards.every(card => /: (Ready|Using emoji|Kept picture)$/.test(card.getAttribute('aria-label') ?? ''))) return 'fallback';
      return false;
    }, undefined, { timeout }).then(handle => handle.jsonValue())]);
    if (outcome === 'request-error') throw new Error('Proposal HTTP failure.');
    await page.locator('[data-testid="card-picture"] img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
    suitable = outcome === 'ready';
    if (!suitable) error = 'Completed with unsuitable fallback pictures.';
  } catch { error = httpStatus && httpStatus >= 400 ? `Proposal HTTP ${httpStatus}.` : 'Pictures not suitable before benchmark deadline.'; }
  const readyMs = Date.now() - started;
  const contentValid = Boolean(proposal?.proposal && proposal.proposal.tiles.length === 6 && fixture.words.every(word => proposal!.proposal.tiles.some(tile => tile.label.toLowerCase() === word || tile.pictureConcept?.description === word || (word === 'chicken' && tile.pictureConcept?.description === 'chicken animal'))));
  const assets = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => entry.name.includes('/api/pictures/assets/')).map(entry => entry.duration));
  const result: Result = { condition, fixture: fixture.id, requestId, httpStatus, draftMs, readyMs, suitable, contentValid, templateHit: proposal?.timing?.templateHit ?? false, pictures: await page.getByTestId('card-picture').count(), assetDownloadMs: Math.round(assets.reduce((sum, value) => sum + value, 0)), ...(error ? { error } : {}) };
  if (capture || error) await page.screenshot({ path: join(directory, `${condition}-${fixture.id}${error ? `-failed-${requestId}` : ''}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Back to boards', exact: true }).click().catch(() => {});
  await context.close();
  results.push(result); console.log(JSON.stringify(result));
  await writeFile(join(directory, 'results.json'), JSON.stringify({ samples, generation: process.argv.includes('--generate'), results, events }, null, 2));
}
const browser = await chromium.launch({ headless: true });
try {
  for (const condition of conditions) {
    const shared = condition === 'cold' ? undefined : await server(condition, condition);
    try {
      if (condition === 'warm') for (const fixture of cases) {
        // Warm through the actual route; warmup is recorded separately from the measured population.
        await measure(browser, shared!.url, 'warmup', fixture);
      }
      const concurrency = condition === 'concurrent' ? 4 : 1;
      for (let offset = 0; offset < samples; offset += concurrency) {
        await Promise.all(Array.from({ length: Math.min(concurrency, samples - offset) }, async (_, slot) => {
          const i = offset + slot; const fixture = cases[i % cases.length];
          const instance = shared ?? await server(condition, `${condition}-${i}`);
          try { await measure(browser, instance.url, condition, fixture, i < cases.length); }
          finally { if (!shared) await instance.app.close(); }
        }));
      }
    } finally { await shared?.app.close(); }
  }
} finally { await browser.close(); }
const summary = conditions.map(condition => {
  const rows = results.filter(row => row.condition === condition); const times = rows.map(row => row.readyMs).sort((a, b) => a - b);
  return { condition, samples: rows.length, suitable: rows.filter(row => row.suitable && row.contentValid).length, p50Ms: times[Math.ceil(times.length * .5) - 1], p95Ms: times[Math.ceil(times.length * .95) - 1], under10s: rows.filter(row => row.suitable && row.contentValid && row.readyMs < 10000).length };
});
await writeFile(join(directory, 'summary.json'), JSON.stringify({ summary, models: { draft: env.OPENAI_DRAFT_MODEL || 'gpt-6-luna', match: env.OPENAI_PICTURE_MATCH_MODEL || 'gpt-6-luna', image: env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-flare' }, quality: env.OPENAI_IMAGE_QUALITY || 'medium', note: 'Human visual approval is separate. Failed or incomplete requests remain in the denominator.' }, null, 2));
await writeFile(join(directory, 'results.json'), JSON.stringify({ samples, generation: process.argv.includes('--generate'), results, events }, null, 2));
console.log(JSON.stringify({ directory, summary }));
if (summary.some(row => row.p95Ms >= 10000 || row.suitable !== row.samples)) process.exitCode = 1;
