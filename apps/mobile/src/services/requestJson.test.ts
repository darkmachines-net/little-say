/** @file Verifies bounded read recovery, native error normalization, mutation safety, and cancellation during retries. */

import { afterEach, expect, it, vi } from 'vitest';
import { requestJson } from './requestJson';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([
  new TypeError('Network request failed'),
  new Error('java.net.SocketException: Connection reset'),
])('recovers a transient GET transport failure: %s', async error => {
  vi.useFakeTimers();
  const init = { signal: new AbortController().signal, headers: { Authorization: 'Bearer synthetic-token' } };
  const fetch = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(new Response('{"state":"working"}'));
  vi.stubGlobal('fetch', fetch);
  const work = requestJson('https://app.example/api/ai/jobs/job', init);
  await vi.advanceTimersByTimeAsync(499);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect((await work).data).toEqual({ state: 'working' });
  expect(fetch.mock.calls).toEqual(Array(2).fill(['https://app.example/api/ai/jobs/job', init]));
  expect(vi.getTimerCount()).toBe(0);
});

it('retries an interrupted response body before returning the completed read', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce({ json: async () => { throw new TypeError('stream closed'); } })
    .mockResolvedValueOnce(new Response('{"state":"complete"}'));
  vi.stubGlobal('fetch', fetch);
  const work = requestJson('https://app.example/api/ai/jobs/job', { signal: new AbortController().signal });
  await vi.advanceTimersByTimeAsync(500);
  expect((await work).data.state).toBe('complete');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('bounds consecutive failures to three attempts with increasing delays and preserves the cause', async () => {
  vi.useFakeTimers();
  const error = new Error('java.net.SocketException: Socket closed');
  const fetch = vi.fn().mockRejectedValue(error); vi.stubGlobal('fetch', fetch);
  const work = requestJson('https://app.example/api/health', { signal: new AbortController().signal });
  const assertion = expect(work).rejects.toMatchObject({ name: 'TypeError', cause: error });
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(999);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  await assertion;
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('does not replay a failed %s', async method => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValue(new Error('java.net.SocketException: Connection reset'));
  vi.stubGlobal('fetch', fetch);
  await expect(requestJson('https://app.example/api/boards/propose', { method, body: '{}', signal: new AbortController().signal })).rejects.toBeInstanceOf(TypeError);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not replay a mutation when only the response body was lost', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue({ json: async () => { throw new TypeError('stream closed'); } });
  vi.stubGlobal('fetch', fetch);
  await expect(requestJson('https://app.example/api/boards/propose', { method: 'POST', body: '{}', signal: new AbortController().signal })).rejects.toBeInstanceOf(TypeError);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([401, 403, 429, 503])('returns HTTP %s to the caller without retrying', async status => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue(new Response('{"error":"Request failed"}', { status }));
  vi.stubGlobal('fetch', fetch);
  const result = await requestJson('https://app.example/api/ai/jobs/job', { signal: new AbortController().signal });
  expect(result.response.status).toBe(status);
  expect(result.data).toEqual({ error: 'Request failed' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('reports malformed JSON without treating it as a transport failure', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue(new Response('<html>Service unavailable</html>'));
  vi.stubGlobal('fetch', fetch);
  await expect(requestJson('https://app.example/api/health', { signal: new AbortController().signal })).rejects.toThrow('unexpected response');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels during a retry delay without another request or a leftover timer', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValue(new TypeError('Network request failed')); vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const work = requestJson('https://app.example/api/health', { signal: controller.signal });
  const assertion = expect(work).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(250);
  controller.abort(); await assertion;
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not send a request with an already cancelled signal', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const controller = new AbortController(); controller.abort();
  await expect(requestJson('https://app.example/api/health', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch).not.toHaveBeenCalled();
});
