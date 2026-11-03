/** @file Verifies authenticated routing, AI progress, Android release/Dev socket failures, deadlines, and cancellation. */
import { afterEach, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'web' }));
vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: { serverUrl: 'https://app.example' } } } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => '10000000-0000-4000-8000-000000000001' }));
vi.mock('./accountSession', () => ({ loadAccountSession: async () => null }));
vi.mock('./requestAuth', () => ({ applicationHeaders: async () => ({}) }));
afterEach(() => { platform.OS = 'web'; vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

it('reports queue and drafting states until a usable partial board is available', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('__DEV__', false); vi.stubGlobal('window', { location: { origin: 'https://app.example' } });
  const envelope = { boardId: null, baseRevision: null, proposal: { title: '', explanation: 'Which animals?', needsClarification: true, tiles: [] } };
  const job = { id: '10000000-0000-4000-8000-000000000001', kind: 'proposal', state: 'queued', result: null };
  const response = (data: unknown, status = 200) => ({ ok: true, status, json: async () => data });
  const fetch = vi.fn().mockResolvedValueOnce(response(job, 202))
    .mockResolvedValueOnce(response({ ...job, state: 'working' }))
    .mockResolvedValueOnce(response({ ...job, state: 'working', result: envelope }));
  vi.stubGlobal('fetch', fetch);
  const { proposeBoard } = await import('./api'); const progress = vi.fn();
  const work = proposeBoard('https://app.example', { prompt: 'Animals', board: null }, undefined, progress);
  await vi.advanceTimersByTimeAsync(0);
  expect(progress).toHaveBeenLastCalledWith('Waiting for AI to start…');
  await vi.advanceTimersByTimeAsync(500);
  expect(progress).toHaveBeenLastCalledWith('Choosing words and translations…');
  await vi.advanceTimersByTimeAsync(500);
  expect(await work).toEqual(envelope);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('continues the accepted board job after a socket failure without resubmitting or cancelling it', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('__DEV__', false); vi.stubGlobal('window', { location: { origin: 'https://app.example' } });
  const envelope = { boardId: null, baseRevision: null, proposal: { title: '', explanation: 'Which animals?', needsClarification: true, tiles: [] } };
  const job = { id: '10000000-0000-4000-8000-000000000001', kind: 'proposal', state: 'queued', result: null };
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(job), { status: 202 }))
    .mockRejectedValueOnce(new Error('java.net.SocketException: Connection reset'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...job, state: 'complete', result: envelope })));
  vi.stubGlobal('fetch', fetch);
  const { proposeBoard } = await import('./api');
  const work = proposeBoard('https://app.example', { prompt: 'Animals', board: null });
  await vi.advanceTimersByTimeAsync(1000);
  expect(await work).toEqual(envelope);
  expect(fetch.mock.calls.map(([url, init]) => [url, init.method ?? 'GET'])).toEqual([
    ['https://app.example/api/boards/propose', 'POST'],
    [`https://app.example/api/ai/jobs/${job.id}`, 'GET'],
    [`https://app.example/api/ai/jobs/${job.id}`, 'GET'],
  ]);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([false, true])('shows a readable Android connection error without replaying a submission (__DEV__=%s)', async development => {
  platform.OS = 'android'; vi.stubGlobal('__DEV__', development); vi.stubEnv('EXPO_PUBLIC_API_URL', '');
  // Expo's native FetchError extends Error, not the TypeError used by browser fetch.
  const fetch = vi.fn().mockRejectedValue(new Error('fetch failed: java.net.SocketException: Socket closed'));
  vi.stubGlobal('fetch', fetch);
  const { proposeBoard } = await import('./api');
  await expect(proposeBoard('', { prompt: 'Animals', board: null })).rejects.toThrow('Cannot reach Little Say');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('https://app.example/api/boards/propose', expect.objectContaining({ method: 'POST' }));
});

it('cancels the accepted job when stopped during a polling retry delay', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('__DEV__', false); vi.stubGlobal('window', { location: { origin: 'https://app.example' } });
  const job = { id: '10000000-0000-4000-8000-000000000001', kind: 'proposal', state: 'working', result: null };
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(job), { status: 202 }))
    .mockRejectedValueOnce(new TypeError('Network request failed'))
    .mockResolvedValueOnce(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  const { apiFetch } = await import('./api'); const controller = new AbortController();
  const work = apiFetch('https://app.example', '/api/boards/propose', { method: 'POST', body: '{}' }, controller.signal);
  const assertion = expect(work).rejects.toThrow('Request cancelled');
  await vi.advanceTimersByTimeAsync(750);
  controller.abort(); await assertion;
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetch.mock.calls.map(([url, init]) => [url, init.method ?? 'GET'])).toEqual([
    ['https://app.example/api/boards/propose', 'POST'],
    [`https://app.example/api/ai/jobs/${job.id}`, 'GET'],
    [`https://app.example/api/ai/jobs/${job.id}/cancel`, 'POST'],
  ]);
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the original HTTP deadline across retries', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('__DEV__', false); vi.stubGlobal('window', { location: { origin: 'https://app.example' } });
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Network request failed'))
    .mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('java.net.SocketException: Socket closed')), { once: true })));
  vi.stubGlobal('fetch', fetch);
  const { apiFetch } = await import('./api');
  const work = apiFetch('https://app.example', '/api/health');
  const assertion = expect(work).rejects.toThrow('The server took too long');
  await vi.advanceTimersByTimeAsync(59999);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][1].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await assertion;
  expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('pins account credentials to the consented server while ordinary requests follow the development backend', async () => {
  vi.stubGlobal('__DEV__', true);
  vi.stubGlobal('window', { location: { origin: 'https://development.example' } });
  vi.stubEnv('EXPO_PUBLIC_WEB_API_URL', 'https://development.example');
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal('fetch', fetch);
  const { apiFetch } = await import('./api');
  await apiFetch('https://consented.example', '/api/account/session', { headers: { Authorization: 'Bearer synthetic-token' } }, undefined, true);
  expect(fetch).toHaveBeenLastCalledWith('https://consented.example/api/account/session', expect.objectContaining({ headers: { 'X-Little-Say': '1', Authorization: 'Bearer synthetic-token' } }));
  await apiFetch('https://consented.example', '/api/health');
  expect(fetch).toHaveBeenLastCalledWith('https://development.example/api/health', expect.objectContaining({ headers: { 'X-Little-Say': '1' } }));
});

it('discovers preparation once per backend session and preserves older proposal servers', async () => {
  vi.stubGlobal('__DEV__', false); vi.stubGlobal('window', { location: { origin: 'https://new.example' } });
  const envelope = { boardId: null, baseRevision: null, proposal: { title: '', explanation: 'Which animals?', needsClarification: true, tiles: [] } };
  const fetch = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/health') ? (url.includes('old.example') ? {} : { pictures: { version: 1 }, preparation: { version: 1 } }) : envelope }));
  vi.stubGlobal('fetch', fetch);
  const { proposeBoard } = await import('./api');
  const request = { prompt: 'Animals', board: null, pictureCapability: 1 as const };
  await proposeBoard('https://new.example', request); await proposeBoard('https://new.example', request);
  vi.stubGlobal('window', { location: { origin: 'https://old.example' } });
  await proposeBoard('https://old.example', request);
  expect(fetch.mock.calls.filter(call => call[0].endsWith('/health'))).toHaveLength(2);
  const posts = vi.mocked(globalThis.fetch).mock.calls.filter(call => String(call[0]).endsWith('/propose'));
  expect(JSON.parse(posts[0][1]!.body as string).preparationId).toBe('10000000-0000-4000-8000-000000000001');
  expect(JSON.parse(posts[2][1]!.body as string)).toEqual({ prompt: 'Animals', board: null });
});

it('sends cancellation even when an initial prepared proposal has not returned', async () => {
  vi.stubGlobal('__DEV__', false); vi.stubGlobal('window', { location: { origin: 'https://app.example' } });
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/propose')) return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
    return { ok: true, json: async () => ({ pictures: { version: 1 }, preparation: { version: 1 } }) };
  });
  vi.stubGlobal('fetch', fetch);
  const { proposeBoard } = await import('./api'); const controller = new AbortController();
  const work = proposeBoard('https://new.example', { prompt: 'Animals', board: null, pictureCapability: 1 }, controller.signal);
  const assertion = expect(work).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(fetch.mock.calls.some(call => call[0].endsWith('/propose'))).toBe(true));
  controller.abort(); await assertion;
  expect(fetch.mock.calls.some(call => call[0].endsWith('/api/pictures/batches/10000000-0000-4000-8000-000000000001/cancel'))).toBe(true);
});
