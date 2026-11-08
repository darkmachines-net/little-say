/** @file Verifies interactive native Google selection, ephemeral provider state, Apple nonce/state integrity, cancellation, and configuration guards. */
import { beforeEach, expect, it, vi } from 'vitest';
import { GoogleAuthProvider, OAuthProvider } from 'firebase/auth';
import type { AuthConfig } from '@little-say/core';
import { nativeCredential } from './firebaseProviders';

const native = vi.hoisted(() => ({ OS: 'ios' }));
const google = vi.hoisted(() => ({ configure: vi.fn(), checkPlayServices: vi.fn(), signOut: vi.fn(), presentExplicitSignIn: vi.fn() }));
const apple = vi.hoisted(() => ({ isSupported: true, performRequest: vi.fn(), Error: { CANCELED: '1001' }, Operation: { LOGIN: 1 }, Scope: { FULL_NAME: 1, EMAIL: 0 } }));
const randomUUID = vi.hoisted(() => vi.fn());
const extra = vi.hoisted(() => ({ googleIosUrlScheme: 'com.googleusercontent.apps.ios-client' }));
vi.mock('react-native', () => ({ Platform: native }));
vi.mock('expo-constants', () => ({ default: { executionEnvironment: 'standalone', expoConfig: { extra } }, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
vi.mock('expo-crypto', () => ({ randomUUID }));
vi.mock('react-native-nitro-google-signin', () => ({
  GoogleOneTapSignIn: google,
  isSuccessResponse: (response: any) => response.type === 'success',
  isCancelledResponse: (response: any) => response.type === 'cancelled',
  isErrorWithCode: (error: any) => typeof error?.code === 'string',
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));
vi.mock('@invertase/react-native-apple-authentication', () => ({ appleAuth: apple }));

const config: AuthConfig = { projectId: 'test', apiKey: 'key', appId: 'app', authDomain: 'test.firebaseapp.com', providers: ['google.com', 'apple.com'], googleWebClientId: 'web-client', googleIosClientId: 'ios-client.apps.googleusercontent.com' };
const success = { type: 'success', data: { idToken: 'google-token' } };
beforeEach(() => {
  vi.resetAllMocks(); native.OS = 'ios'; apple.isSupported = true;
  extra.googleIosUrlScheme = 'com.googleusercontent.apps.ios-client';
  google.signOut.mockResolvedValue(undefined); google.presentExplicitSignIn.mockResolvedValue(success);
  randomUUID.mockReturnValueOnce('raw-nonce').mockReturnValueOnce('request-state');
  apple.performRequest.mockResolvedValue({ identityToken: 'apple-token', authorizationCode: 'revocation-code', state: 'request-state' });
});

it.each(['ios', 'android'])('prompts for a Google identity on %s and clears native state before/after the attempt', async platform => {
  native.OS = platform;
  const result = await nativeCredential('google.com', config);
  expect(result.credential.toJSON()).toEqual(GoogleAuthProvider.credential('google-token').toJSON());
  expect(google.configure).toHaveBeenCalledWith({ webClientId: 'web-client', offlineAccess: false, ...(platform === 'ios' ? { iosClientId: config.googleIosClientId } : {}) });
  expect(google.checkPlayServices).toHaveBeenCalledOnce();
  expect(google.presentExplicitSignIn).toHaveBeenCalledOnce(); expect(google.signOut).toHaveBeenCalledTimes(2);
  expect(google.signOut.mock.invocationCallOrder[0]).toBeLessThan(google.presentExplicitSignIn.mock.invocationCallOrder[0]);
  expect(google.signOut.mock.invocationCallOrder[1]).toBeGreaterThan(google.presentExplicitSignIn.mock.invocationCallOrder[0]);
});

it('stops after Google cancellation and clears provider state', async () => {
  google.presentExplicitSignIn.mockResolvedValue({ type: 'cancelled' });
  await expect(nativeCredential('google.com', config)).rejects.toMatchObject({ code: 'auth/user-cancelled' });
  expect(google.presentExplicitSignIn).toHaveBeenCalledOnce(); expect(google.signOut).toHaveBeenCalledTimes(2);
});

it('normalizes thrown Google cancellation and preserves Play Services failures', async () => {
  google.presentExplicitSignIn.mockRejectedValue(Object.assign(new Error('Cancelled'), { code: 'SIGN_IN_CANCELLED' }));
  await expect(nativeCredential('google.com', config)).rejects.toMatchObject({ code: 'auth/user-cancelled' });
  const unavailable = Object.assign(new Error('Play Services unavailable'), { code: 'PLAY_SERVICES_NOT_AVAILABLE' });
  google.checkPlayServices.mockRejectedValue(unavailable);
  await expect(nativeCredential('google.com', config)).rejects.toBe(unavailable);
  expect(google.presentExplicitSignIn).toHaveBeenCalledOnce();
});

it('rejects missing Google tokens and configuration before exchanging credentials', async () => {
  await expect(nativeCredential('google.com', { ...config, googleWebClientId: '' })).rejects.toThrow('not configured');
  expect(google.configure).not.toHaveBeenCalled();
  google.presentExplicitSignIn.mockResolvedValue({ type: 'success', data: { idToken: null } });
  await expect(nativeCredential('google.com', config)).rejects.toThrow('identity token');
});

it.each(['', 'invalid-scheme'])('rejects an absent or malformed iOS callback scheme before loading the sign-in UI: %s', async scheme => {
  extra.googleIosUrlScheme = scheme;
  await expect(nativeCredential('google.com', config)).rejects.toThrow('app build configured for this server');
  expect(google.configure).not.toHaveBeenCalled(); expect(google.presentExplicitSignIn).not.toHaveBeenCalled();
});

it('uses the development binary OAuth client even when the server advertises the store client', async () => {
  extra.googleIosUrlScheme = 'com.googleusercontent.apps.dev-client';
  await nativeCredential('google.com', config);
  expect(google.configure).toHaveBeenCalledWith(expect.objectContaining({ iosClientId: 'dev-client.apps.googleusercontent.com' }));
});

it('does not discard a valid credential if provider cleanup fails', async () => {
  google.signOut.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Cleanup failed'));
  await expect(nativeCredential('google.com', config)).resolves.toHaveProperty('credential');
});

it('passes the unhashed Apple nonce to the SDK and Firebase, retaining the code for deletion', async () => {
  const result = await nativeCredential('apple.com', config);
  expect(apple.performRequest).toHaveBeenCalledWith({ requestedOperation: 1, requestedScopes: [1, 0], nonce: 'raw-nonce', state: 'request-state' });
  expect(result.credential.toJSON()).toEqual(new OAuthProvider('apple.com').credential({ idToken: 'apple-token', rawNonce: 'raw-nonce' }).toJSON());
  expect(result.apple).toEqual({ token: 'revocation-code', type: 'CODE' });
});

it.each([{ identityToken: null, state: 'request-state' }, { identityToken: 'token', state: 'different-state' }])('rejects unverifiable Apple responses: %j', async response => {
  apple.performRequest.mockResolvedValue(response);
  await expect(nativeCredential('apple.com', config)).rejects.toThrow('could not be verified');
});

it('normalizes native Apple cancellation', async () => {
  apple.performRequest.mockRejectedValue({ code: '1001' });
  await expect(nativeCredential('apple.com', config)).rejects.toMatchObject({ code: 'auth/user-cancelled' });
});

it('rejects unsupported Apple devices and never opens an Android browser flow', async () => {
  apple.isSupported = false;
  await expect(nativeCredential('apple.com', config)).rejects.toThrow('unavailable on this device');
  native.OS = 'android';
  await expect(nativeCredential('apple.com', config)).rejects.toThrow('iOS app or website');
  expect(apple.performRequest).not.toHaveBeenCalled();
});
