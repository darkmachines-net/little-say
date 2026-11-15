/** @file Exercises account activity and explicit retry after a board admission cooldown in the browser. */

import { test, expect } from '@playwright/test';
import { openExistingLibrary } from './existingLibrary';

test('shows pending account work and lets a parent edit the prompt before sending again', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/ai/activity', route => route.fulfill({ json: {
    boards: { queued: 0, working: 1 }, speech: { queued: 0, working: 0 }, other: { queued: 0, working: 0 },
  } }));
  let submissions = 0;
  await page.route('**/api/boards/propose', route => {
    if (++submissions === 1) return route.fulfill({ status: 429, headers: { 'Retry-After': '4' }, json: {
      error: 'Too many board requests.', reason: 'rate-limit', retryAfterSeconds: 4,
    } });
    return route.fulfill({ json: { boardId: null, baseRevision: null, proposal: { title: '', explanation: 'Which animals?', needsClarification: true, tiles: [] } } });
  });
  await openExistingLibrary(page);
  await expect(page.getByTestId('background-ai-status')).toContainText('1 board request in progress.');
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  const prompt = page.getByRole('textbox', { name: 'Message to AI', exact: true });
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  await prompt.fill('Six animals');
  await send.click();
  await expect(page.getByText('You’ve reached the board request limit.')).toBeVisible();
  await expect(page.getByTestId('board-ai-retry')).toHaveText(/Try again in \d+ seconds?\./);
  await expect(send).toBeDisabled();
  await expect(prompt).toHaveValue('Six animals');
  await prompt.fill('Five animals');
  await expect(send).toBeEnabled();
  expect(submissions).toBe(1);
  await send.click();
  await expect(page.getByText('Which animals?', { exact: true })).toBeVisible();
  expect(submissions).toBe(2);
});
