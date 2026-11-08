/** @file Verifies Google/Apple credential exchange, native sessions, shared browser CSRF, and safe cancellation/conflict handling. */
import { beforeEach, expect, it, vi } from 'vitest';
import { authenticateAccount, accountError } from './firebaseAccount';

const native = vi.hoisted(() => ({ OS: 'ios' }));
const mocks = vi.hoisted(() => ({ initialize: vi.fn(), credential: vi.fn(), popup: vi.fn(), register: vi.fn(), password: vi.fn(), token: vi.fn(), signOut: vi.fn(), nativeCredential: vi.fn(), fetch: vi.fn(), verify: vi.fn(), csrf: vi.fn() }));
vi.mock('react-native', () => ({ Platform: native }));
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: async (_algorithm: string, value: string) => value }));
vi.mock('firebase/app', () => ({ initializeApp: vi.fn() }));
vi.mock('firebase/auth', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/auth')>(),
  initializeAuth: mocks.initialize, signInWithCredential: mocks.credential, signInWithPopup: mocks.popup,
  createUserWithEmailAndPassword: mocks.register, signInWithEmailAndPassword: mocks.password,
  getIdToken: mocks.token, signOut: mocks.signOut, sendEmailVerification: mocks.verify,
}));
vi.mock('./firebasePersistence', () => ({ authDependencies: () => ({}) }));
vi.mock('./firebaseProviders', () => ({ nativeCredential: mocks.nativeCredential, socialAuthAvailable: () => true }));
vi.mock('./api', () => ({ apiFetch: mocks.fetch }));
vi.mock('./browserCsrf', () => ({ browserCsrfHeaders: mocks.csrf }));

const config = { projectId: 'test', apiKey: 'key', appId: 'app', authDomain: 'test.firebaseapp.com', providers: ['password', 'google.com', 'apple.com'] };
const user = { uid: 'firebase-uid', emailVerified: true };
const auth = { authStateReady: vi.fn(async () => {}) };
const credential = { providerId: 'provider' };
const response = { account: { id: '00000000-0000-4000-8000-000000000001', email: 'private@privaterelay.appleid.com', displayName: null, emailVerified: true, providers: ['apple.com'] } };
let sequence = 0, server: string;
beforeEach(() => {
  vi.clearAllMocks(); native.OS = 'ios'; server = `https://server-${++sequence}.test`;
  mocks.initialize.mockReturnValue(auth); mocks.nativeCredential.mockResolvedValue({ credential });
  mocks.credential.mockResolvedValue({ user }); mocks.popup.mockResolvedValue({ user }); mocks.token.mockResolvedValue('firebase-id-token');
  mocks.csrf.mockResolvedValue({ 'X-Little-Say-CSRF': 'csrf' });
  mocks.fetch.mockImplementation(async (_server: string, path: string) => {
    if (path === '/api/account/config') return config;
    if (path === '/api/account/session') return response;
    throw new Error('Unexpected API call');
  });
});

it.each([
  { platform: 'ios', provider: 'google.com' as const },
  { platform: 'ios', provider: 'apple.com' as const },
  { platform: 'android', provider: 'google.com' as const },
])('uses the same Firebase credential and session flow for new/returning $provider users on $platform', async ({ platform, provider }) => {
  native.OS = platform;
  for (const mode of ['register', 'login'] as const) {
    const session = await authenticateAccount(server, mode, '', '', provider);
    expect(mocks.nativeCredential).toHaveBeenLastCalledWith(provider, config);
    expect(mocks.credential).toHaveBeenLastCalledWith(auth, credential);
    expect(session).toEqual({ ...response, server, firebaseUid: user.uid, authConfig: config });
    expect(mocks.fetch).toHaveBeenLastCalledWith(server, '/api/account/session', expect.objectContaining({ method: 'POST', body: JSON.stringify({ idToken: 'firebase-id-token', native: true }) }), undefined, true);
  }
  expect(mocks.register).not.toHaveBeenCalled(); expect(mocks.password).not.toHaveBeenCalled(); expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.popup).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled();
  expect(mocks.csrf).not.toHaveBeenCalled();
});

it('does not exchange or create a session after native cancellation', async () => {
  const error = Object.assign(new Error('cancelled'), { code: 'auth/user-cancelled' });
  mocks.nativeCredential.mockRejectedValueOnce(error);
  await expect(authenticateAccount(server, 'register', '', '', 'apple.com')).rejects.toBe(error);
  expect(mocks.credential).not.toHaveBeenCalled(); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(accountError(error)).toBe('Sign-in was cancelled. Your local boards are unchanged.');
});

it('preserves account-conflict recovery without exchanging an unverified session', async () => {
  const error = { code: 'auth/account-exists-with-different-credential' };
  mocks.credential.mockRejectedValueOnce(error);
  await expect(authenticateAccount(server, 'login', '', '', 'google.com')).rejects.toBe(error);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(accountError(error)).toContain('link the additional method in Settings');
});

it('retains browser popup authentication and cookie exchange without loading native providers', async () => {
  native.OS = 'web';
  await authenticateAccount(server, 'login', '', '', 'google.com');
  expect(mocks.popup).toHaveBeenCalledOnce(); expect(mocks.nativeCredential).not.toHaveBeenCalled();
  expect(mocks.csrf).toHaveBeenCalledWith(server);
  expect(mocks.fetch).toHaveBeenLastCalledWith(server, '/api/account/session', expect.objectContaining({ headers: expect.objectContaining({ 'X-Little-Say-CSRF': 'csrf' }), body: JSON.stringify({ idToken: 'firebase-id-token', native: false }) }), undefined, true);
  expect(mocks.signOut).toHaveBeenCalledWith(auth);
});
