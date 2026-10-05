/** @file Remembers only a per-origin billing preference so missing cookies never silently select the server's API key. */

const selections = new Map<string, boolean>();
const key = (server: string) => `little-say:chatgpt:${new URL(server).origin}`;
/** Read the non-secret billing preference; OpenAI credentials are never stored in browser storage. */
export function prefersChatGpt(server: string): boolean {
  try { return window.localStorage.getItem(key(server)) === 'true'; }
  catch { return selections.get(server) === true; }
}
/** Change billing selection only after connection readback or an explicit disconnect. */
export function rememberChatGpt(server: string, selected: boolean): void {
  selections.set(server, selected);
  try { if (selected) window.localStorage.setItem(key(server), 'true'); else window.localStorage.removeItem(key(server)); }
  catch { /* The in-memory preference still protects this tab when storage is unavailable. */ }
}
