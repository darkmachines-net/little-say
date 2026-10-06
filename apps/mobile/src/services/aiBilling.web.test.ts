/** @file Guards selected billing under storage quota failures, explicit disconnect, cross-tab changes, and missing-cookie API requests. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer } from '../../../server/src/app';
import { apiFetch } from './api';
import { prefersChatGpt, rememberChatGpt } from './aiBilling.web';
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('./aiBilling', () => import('./aiBilling.web'));

let values: Map<string, string>;
let browser: EventTarget & { localStorage: Storage; location: { origin: string } };
let failWrite: boolean;
let failRead: boolean;
let origin: string;
beforeEach(() => {
  values = new Map(); failWrite = false; failRead = false;
  origin = `https://test-${crypto.randomUUID()}.example`;
  const storage = {
    getItem: (key: string) => { if (failRead) throw new Error('unavailable'); return values.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (failWrite) throw new DOMException('full', 'QuotaExceededError'); values.set(key, value); },
    removeItem: (key: string) => { if (failWrite) throw new DOMException('full', 'QuotaExceededError'); values.delete(key); },
  } as Storage;
  browser = Object.assign(new EventTarget(), { localStorage: storage, location: { origin } });
  vi.stubGlobal('window', browser);
});
afterEach(() => { vi.unstubAllGlobals(); });

it('retains quota-failed selection across same-origin paths and honors explicit disconnect even when removal fails', () => {
  failWrite = true;
  rememberChatGpt(origin + '/app', true);
  expect(prefersChatGpt(origin)).toBe(true);
  values.set(`little-say:chatgpt:${origin}`, 'true');
  rememberChatGpt(origin, false);
  expect(prefersChatGpt(origin + '/other')).toBe(false);
  failWrite = false;
  rememberChatGpt(origin, true);
  values.delete(`little-say:chatgpt:${origin}`);
  expect(prefersChatGpt(origin)).toBe(false);
});

it('observes another tab selecting, disconnecting or clearing storage, including after a failed local write', () => {
  const key = `little-say:chatgpt:${origin}`;
  const change = (newValue: string | null, eventKey: string | null = key) => {
    if (newValue === null) values.delete(key); else values.set(key, newValue);
    browser.dispatchEvent(Object.assign(new Event('storage'), { key: eventKey, newValue, storageArea: browser.localStorage }));
  };
  failWrite = true; rememberChatGpt(origin, true);
  change(null); expect(prefersChatGpt(origin)).toBe(false);
  change('true'); expect(prefersChatGpt(origin)).toBe(true);
  change(null, null); expect(prefersChatGpt(origin)).toBe(false);
});

it('retains known selection when reads and writes are unavailable', () => {
  rememberChatGpt(origin, true); failRead = true; failWrite = true;
  expect(prefersChatGpt(origin)).toBe(true);
  rememberChatGpt(origin, false); expect(prefersChatGpt(origin)).toBe(false);
});

it('sends selected billing through apiFetch without a cookie after quota failure and never invokes the server provider', async () => {
  const propose = vi.fn(async () => ({ title: 'Farm', explanation: 'Synthetic.', needsClarification: false, tiles: [] }));
  const server = await createServer({ provider: { propose, transcribe: vi.fn() } });
  const headersSeen: Record<string, string>[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries()); headersSeen.push(headers);
    const response = await server.inject({ method: 'POST', url: new URL(url).pathname, headers, payload: init.body as string });
    return new Response(response.body, { status: response.statusCode });
  });
  try {
    failWrite = true; rememberChatGpt(origin, true);
    await expect(apiFetch(origin, '/api/boards/propose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'A farm board', board: null }) }, undefined, true)).rejects.toMatchObject({ status: 401 });
    expect(headersSeen[0]['x-little-say-ai']).toBe('chatgpt');
    expect(headersSeen[0]).not.toHaveProperty('cookie');
    expect(propose).not.toHaveBeenCalled();
  } finally { await server.close(); }
});

