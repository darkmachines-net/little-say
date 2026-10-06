/** @file Exercises optional ChatGPT browser connection, first-use disclosure, billing persistence, usage-limit recovery, and explicit disconnection with mocked OpenAI state. */

import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openExistingLibrary } from './existingLibrary';

const disconnected = { available: true, selected: false, connected: false, planEnabled: false, needsLogin: false, welcome: false };
test('shows hosted availability honestly and keeps manual use available', async ({ page }) => {
  await openExistingLibrary(page);
  await page.getByRole('button', { name: 'Parent settings', exact: true }).click();
  await expect(page.getByText('ChatGPT connection has not been enabled on this server.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with ChatGPT', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Parent settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New board', exact: true })).toBeVisible();
});

for (const width of [1180, 390]) test(`connected ChatGPT settings, composer, and explicit server billing at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  let state = { ...disconnected, selected: true, connected: true, planEnabled: true, welcome: true, email: 'parent@example.com' };
  await page.route('**/api/chatgpt/status', route => route.fulfill({ json: state }));
  await page.route('**/api/chatgpt/acknowledge', async route => { state = { ...state, welcome: false }; await route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/chatgpt/disconnect', async route => { state = { ...state, ...disconnected }; await route.fulfill({ json: { revoked: true } }); });
  await openExistingLibrary(page);
  await page.getByRole('button', { name: 'Parent settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'You’re using your ChatGPT plan', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.getByRole('heading', { name: 'AI requests', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
  await expect(page.getByText('parent@example.com', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Parent settings', exact: true }).click();
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await expect(page.getByText('Using ChatGPT plan', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Voice prompt', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Picture settings', exact: true })).toHaveCount(0);
  let requests = 0;
  await page.route('**/api/boards/propose', async route => {
    requests++;
    expect(route.request().headers()['x-little-say-ai']).toBe('chatgpt');
    await route.fulfill({ status: 429, json: { error: 'ChatGPT usage limit reached. Open Manage usage to review your plan or app limit.' } });
  });
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('A farm board');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText(/ChatGPT usage limit reached/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message to AI', exact: true })).toHaveValue('A farm board');
  await expect(page.getByRole('button', { name: 'Manage usage', exact: true })).toBeInViewport();
  expect(requests).toBe(1);
  await page.getByRole('button', { name: 'Back to boards', exact: true }).click();
  await page.getByRole('button', { name: 'Parent settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'You’re using your ChatGPT plan', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Disconnect ChatGPT & use server AI', exact: true }).click();
  await expect(page.getByText('Using the server’s API key', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem(`little-say:chatgpt:${location.origin}`))).toBeNull();
});

test('Continue with ChatGPT starts the approved authorization flow and returns to the connection settings', async ({ page }) => {
  let state = { ...disconnected };
  await page.route('**/api/chatgpt/acknowledge', async route => { state = { ...state, welcome: false }; await route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/chatgpt/status', route => route.fulfill({ json: state }));
  await page.route('**/api/chatgpt/connect', route => route.fulfill({ json: { url: 'https://auth.openai.com/api/accounts/authorize?client_id=oaiapp_test' } }));
  await page.route('https://auth.openai.com/api/accounts/authorize?*', async route => {
    state = { ...state, selected: true, connected: true, planEnabled: true, welcome: true };
    await route.fulfill({ status: 302, headers: { location: 'http://127.0.0.1:4175/app?chatgpt=connected' } });
  });
  await openExistingLibrary(page);
  await page.getByRole('button', { name: 'Parent settings', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'You’re using your ChatGPT plan', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.getByRole('button', { name: 'Close Parent settings', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Parent settings', exact: true })).toHaveCount(0);
});

test('an expired cookie preserves the visitor billing choice and sends the fail-closed header', async ({ page }) => {
  await page.route('**/api/chatgpt/status', route => route.fulfill({ json: disconnected }));
  await openExistingLibrary(page);
  await page.evaluate(() => localStorage.setItem(`little-say:chatgpt:${location.origin}`, 'true'));
  await page.getByRole('button', { name: 'Parent settings', exact: true }).click();
  await expect(page.getByText('ChatGPT selected — reconnect or allow plan usage', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with ChatGPT', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Parent settings', exact: true }).click();
  await page.route('**/api/boards/propose', async route => {
    expect(route.request().headers()['x-little-say-ai']).toBe('chatgpt');
    await route.fulfill({ status: 401, json: { error: 'Reconnect ChatGPT in Parent settings. The server API key was not used.' } });
  });
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('A farm board');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Reconnect ChatGPT in Parent settings. The server API key was not used.', { exact: true })).toBeVisible();
});

test('a ChatGPT clarification becomes a recorded saveable draft without unsupported pictures', async ({ page }) => {
  await page.route('**/api/chatgpt/status', route => route.fulfill({ json: { ...disconnected, selected: true, connected: true, planEnabled: true } }));
  const pictureRequests: string[] = [];
  let turns = 0;
  await page.route('**/api/pictures/**', route => { pictureRequests.push(route.request().url()); return route.abort(); });
  await page.route('**/api/boards/propose', route => {
    const request = route.request().postDataJSON();
    expect(route.request().headers()['x-little-say-ai']).toBe('chatgpt');
    if (++turns === 1) return route.fulfill({ json: { boardId: null, baseRevision: null, proposal: { title: 'Animal words', explanation: 'Which animal?', needsClarification: true, tiles: [] } } });
    expect(request.conversation.history).toEqual([{ prompt: 'An animal', reply: 'Which animal?' }]);
    return route.fulfill({ json: { boardId: null, baseRevision: null, proposal: {
      title: 'Animal words', explanation: 'Here is a cow.', needsClarification: false, playLanguages: ['en-US'], picturePolicy: request.picturePolicy,
      tiles: [{ existingId: null, label: 'Cow', speech: 'Cow', language: 'en-US', emoji: '🐄', color: 'sage', languageMode: 'fixed', translations: [] }],
    } } });
  });
  await openExistingLibrary(page);
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await expect(page.getByText('Using ChatGPT plan', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('An animal');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Which animal?', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message to AI', exact: true }).fill('A cow');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('ai-draft')).toContainText('Cow');
  await expect(page.getByRole('button', { name: 'Use this board', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Create matching AI illustrations', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Picture settings', exact: true })).toHaveCount(0);
  expect(pictureRequests).toEqual([]);
  await expect(page.getByText('Here is a cow.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use this board', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Board title', exact: true })).toHaveValue('Animal words');
});


test('an error callback is displayed once and consumed without discarding other query parameters', async ({ page }) => {
  await openExistingLibrary(page);
  await page.goto('/app?chatgpt=error&retained=yes');
  await expect(page.getByText('ChatGPT connection was cancelled or could not be verified. Your previous AI setting is unchanged. You can try again.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/app\?retained=yes$/);
  await page.getByRole('button', { name: 'Close Parent settings', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Parent settings', exact: true })).toHaveCount(0);
});
