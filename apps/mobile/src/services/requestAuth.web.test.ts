/** @file Verifies cookie-only web authentication, exact-origin binding, mutation CSRF, and public-media isolation. */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const load = vi.hoisted(() => vi.fn());
vi.mock('./accountSession', () => ({ loadAccountSession: load }));
import { applicationHeaders, mediaRequest } from './requestAuth.web';

const fetch = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetch); });
afterEach(() => vi.unstubAllGlobals());
it.each([null, { server: 'https://other.example' }])('rejects missing or mismatched accounts before sending credentials', async session => {
  load.mockResolvedValue(session);
  await expect(applicationHeaders('https://app.example', true)).rejects.toThrow('Sign in');
  expect(fetch).not.toHaveBeenCalled();
});
it('uses cookies for reads and fetches bound CSRF proof only for mutations', async () => {
  load.mockResolvedValue({ server: 'https://app.example', account: { id: 'family' } });
  expect(await mediaRequest('https://app.example/api/speech/clip.wav')).toEqual({ credentials: 'include', redirect: 'error', headers: { 'X-Little-Say-Account': 'family' } });
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockResolvedValue(new Response(JSON.stringify({ csrfToken: 'proof' })));
  expect(await applicationHeaders('https://app.example', true)).toEqual({ 'X-Little-Say-Account': 'family', 'X-Little-Say-CSRF': 'proof' });
  expect(fetch).toHaveBeenCalledWith('https://app.example/api/account/csrf', expect.objectContaining({ credentials: 'include', redirect: 'error', signal: expect.any(AbortSignal) }));
});
it.each([new Response('{}'), new Response('{"csrfToken":"rejected"}', { status: 403 })])('rejects invalid CSRF responses', async response => {
  load.mockResolvedValue({ server: 'https://app.example', account: { id: 'family' } }); fetch.mockResolvedValue(response);
  await expect(applicationHeaders('https://app.example', true)).rejects.toThrow('verify your session');
});
it('does not consult account state or attach credentials to public starter audio', async () => {
  expect(await mediaRequest('https://app.example/api/starter-boards/audio/clip.wav')).toEqual({});
  expect(load).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
