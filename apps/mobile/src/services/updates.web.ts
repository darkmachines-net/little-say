/** @file Registers the production offline web shell, skips Metro on every port, and defers updates until parent approval. */

let waiting: ServiceWorker | null = null;
/**
 * Register the service worker outside Metro, notify when an update waits, and return a callback that
 * removes the update-discovery listener.
 */
export async function initializeUpdates(ready: () => void): Promise<() => void> {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return () => {};
  const registration = await navigator.serviceWorker.register('/sw.js');
  const found = () => {
    if (registration.waiting) { waiting = registration.waiting; ready(); }
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) { waiting = registration.waiting; ready(); } });
  };
  found(); registration.addEventListener('updatefound', found);
  return () => registration.removeEventListener('updatefound', found);
}
/**
 * Activate the waiting service worker and reload after it takes control; do nothing if no update is
 * waiting.
 */
export function applyUpdate() {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}
