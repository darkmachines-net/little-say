import { expect, type Page } from '@playwright/test';
import { starterLibrary } from '../../packages/core/src/starter';

/** Existing-user fixtures intentionally lack the new setup marker. */
export async function openExistingLibrary(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose your languages', exact: true })).toBeVisible();
  await page.evaluate(async library => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('little-say', 2); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(library, 'library');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  }, starterLibrary());
  await page.reload();
  await expect(page.getByText('Your soundboards', { exact: true })).toBeVisible();
}
