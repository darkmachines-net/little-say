/** @file Remembers per-origin billing choices, including failed persistence, so missing cookies cannot silently select server billing. */

const selections = new Map<string, boolean>();
const pending = new Set<string>();
const prefix = 'little-say:chatgpt:';
const key = (server: string) => `${prefix}${new URL(server).origin}`;
let observedWindow: Window | undefined;

/** Observe authoritative changes from other tabs without mistaking failed local writes for disconnection. */
function observeStorage(): void {
  if (observedWindow === window) return;
  observedWindow = window;
  window.addEventListener('storage', event => {
    try { if (event.storageArea !== window.localStorage) return; } catch { return; }
    if (event.key === null) { selections.clear(); pending.clear(); }
    else if (event.key.startsWith(prefix)) {
      selections.set(event.key, event.newValue === 'true');
      pending.delete(event.key);
    }
  });
}

/** Read the non-secret preference; a failed local write takes precedence until a successful write or another tab's change. */
export function prefersChatGpt(server: string): boolean {
  observeStorage();
  const storageKey = key(server);
  if (pending.has(storageKey)) return selections.get(storageKey) === true;
  try {
    const selected = window.localStorage.getItem(storageKey) === 'true';
    selections.set(storageKey, selected);
    return selected;
  } catch { return selections.get(storageKey) === true; }
}

/** Change selection after connection readback or explicit disconnect, retaining the tab's choice if persistence fails. */
export function rememberChatGpt(server: string, selected: boolean): void {
  observeStorage();
  const storageKey = key(server);
  selections.set(storageKey, selected);
  pending.add(storageKey);
  try {
    if (selected) window.localStorage.setItem(storageKey, 'true');
    else window.localStorage.removeItem(storageKey);
    pending.delete(storageKey);
  } catch { /* Keep this explicit choice authoritative in the tab until storage recovers or another tab changes it. */ }
}
