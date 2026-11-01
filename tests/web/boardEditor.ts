/** @file Navigates toolbar settings and waits for durable AI application before the grouped Accept action. */
import { expect, type Page } from '@playwright/test';

/** Wait for an AI turn to finish and save without a review button; fail on unresolved save recovery. */
export async function waitForAiTurn(page: Page) {
  await expect(page.getByTestId('ai-working')).toHaveCount(0);
  await expect(page.getByText('Saving changes…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry saving AI changes', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Keep changes', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
}

/** Open board language setup through the editor toolbar's settings gear. */
export async function openBoardLanguages(page: Page) {
  await page.getByRole('button', { name: 'Board settings', exact: true }).click();
  await page.getByRole('button', { name: 'Languages', exact: true }).click();
}

/** Open board picture controls through the editor toolbar's settings gear. */
export async function openBoardPictures(page: Page) {
  await page.getByRole('button', { name: 'Board settings', exact: true }).click();
  await page.getByRole('button', { name: 'Pictures', exact: true }).click();
}
