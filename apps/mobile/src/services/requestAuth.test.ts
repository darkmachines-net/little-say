/** @file Verifies protected requests require a registered account bound to the target origin, without creating guests. */
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), headers: vi.fn() }));
vi.mock('./accountSession', () => ({ loadAccountSession: mocks.load }));
vi.mock('./firebaseAccount', () => ({ accountAuthHeaders: mocks.headers }));
import { applicationHeaders } from './requestAuth';
beforeEach(() => { vi.clearAllMocks(); mocks.headers.mockResolvedValue({ Authorization: 'Bearer fixture' }); });
it.each([null, { server: 'https://other.example' }])('rejects missing or mismatched sign-in without starting auth', async session => {
  mocks.load.mockResolvedValue(session);
  await expect(applicationHeaders('https://app.example', true)).rejects.toThrow('Sign in');
  expect(mocks.headers).not.toHaveBeenCalled();
});
it('uses the saved registered account for the matching server', async () => {
  const session = { server: 'https://app.example', account: { id: 'family' } }; mocks.load.mockResolvedValue(session);
  expect(await applicationHeaders(session.server, true)).toEqual({ 'X-Little-Say-Account': 'family', Authorization: 'Bearer fixture' });
  expect(mocks.headers).toHaveBeenCalledWith(session, true);
});
