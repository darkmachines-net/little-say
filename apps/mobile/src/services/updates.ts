/** @file Provides the native no-op counterpart of the browser service-worker update controls. */

/** Return an empty cleanup callback; native updates are managed by Expo rather than a service worker. */
export async function initializeUpdates(_ready: () => void): Promise<() => void> { return () => {}; }
/** Leave browser update activation as a no-op on native platforms. */
export function applyUpdate() {}
