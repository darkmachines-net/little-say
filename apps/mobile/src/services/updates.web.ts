let waiting: ServiceWorker | null = null;
export async function initializeUpdates(ready: () => void): Promise<() => void> {
  if (!('serviceWorker' in navigator) || location.port === '8081') return () => {};
  const registration = await navigator.serviceWorker.register('/sw.js');
  const found = () => {
    if (registration.waiting) { waiting = registration.waiting; ready(); }
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) { waiting = registration.waiting; ready(); } });
  };
  found(); registration.addEventListener('updatefound', found);
  return () => registration.removeEventListener('updatefound', found);
}
export function applyUpdate() {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}
