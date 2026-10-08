/** @file Seeds an existing browser library so scenarios can bypass first-use setup intentionally. */

import { starterLibrary } from '../fixtures/library';
import { expect, type Page } from '@playwright/test';

/** Existing-user fixtures intentionally lack the new setup marker. */
export async function openExistingLibrary(page: Page) {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Continue without an account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
  await page.evaluate(async library => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(library, 'library');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  }, { ...starterLibrary(), settings: { ...starterLibrary().settings, accountChoiceMade: true } });
  await page.reload();
  await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
}
