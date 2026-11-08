/** @file Obtains native Google/Apple Firebase credentials with interactive account selection, nonce/state checks, and Expo Go isolation. */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { GoogleAuthProvider, OAuthProvider, type AuthCredential } from 'firebase/auth';
import { type AuthConfig } from '@little-say/core';
export type SocialProvider = 'google.com' | 'apple.com';
export type AppleGrant = { token: string; type: 'CODE' | 'ACCESS_TOKEN'; redirectUri?: string };
export type ProviderCredential = { credential: AuthCredential; apple?: AppleGrant };
/** Expo Go supports email authentication; native social modules require a custom binary. */
export function socialAuthAvailable() { return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient; }
/**
 * Obtain a credential for sign-in, registration, linking, or fresh identity confirmation without changing Firebase accounts.
 * Native SDKs load only in custom builds. Apple hashes the raw nonce before authorization; Firebase verifies it on exchange.
 * Cancellation rejects with auth/user-cancelled; Apple authorization codes are returned only for immediate revocation use.
 */
export async function nativeCredential(provider: SocialProvider, config: AuthConfig): Promise<ProviderCredential> {
  if (!socialAuthAvailable()) throw new Error('Google and Apple sign-in require a development build. Email sign-in works in Expo Go.');
  return provider === 'google.com' ? googleCredential(config) : appleCredential();
}

function cancelled() { return Object.assign(new Error('Sign-in was cancelled. Your local boards are unchanged.'), { code: 'auth/user-cancelled' }); }

async function googleCredential(config: AuthConfig): Promise<ProviderCredential> {
  if (!config.googleWebClientId) throw new Error('Google native sign-in is not configured on this server.');
  // The binary's callback identifies its iOS OAuth client, including the separate development app.
  // Avoid the iOS SDK's native exception when no callback has been configured for the build.
  const scheme: unknown = Constants.expoConfig?.extra?.googleIosUrlScheme;
  const iosClientId = typeof scheme === 'string' && /^com\.googleusercontent\.apps\.[a-zA-Z0-9-]+$/.test(scheme) ? scheme.split('.').reverse().join('.') : undefined;
  if (Platform.OS === 'ios' && !iosClientId) {
    throw new Error('Google sign-in needs an app build configured for this server. Please update the app or use another sign-in method.');
  }
  const { GoogleOneTapSignIn, isSuccessResponse, isCancelledResponse, isErrorWithCode, statusCodes } = await import('react-native-nitro-google-signin');
  try {
    GoogleOneTapSignIn.configure({ webClientId: config.googleWebClientId, offlineAccess: false, ...(Platform.OS === 'ios' ? { iosClientId } : {}) });
    await GoogleOneTapSignIn.checkPlayServices();
    // Always let the user choose, including after app sign-out and during identity confirmation.
    await GoogleOneTapSignIn.signOut();
    const response = await GoogleOneTapSignIn.presentExplicitSignIn();
    if (isCancelledResponse(response)) throw cancelled();
    if (!isSuccessResponse(response) || !response.data.idToken) throw new Error('Google sign-in did not return an identity token. Please try again.');
    return { credential: GoogleAuthProvider.credential(response.data.idToken) };
  } catch (error) {
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) throw cancelled();
    throw error;
  } finally {
    // Firebase owns the persistent session. Native provider state must not select the next account.
    await GoogleOneTapSignIn.signOut().catch(() => {});
  }
}

async function appleCredential(): Promise<ProviderCredential> {
  if (Platform.OS !== 'ios') throw new Error('Use the iOS app or website to sign in with Apple.');
  const { appleAuth } = await import('@invertase/react-native-apple-authentication');
  const nonce = Crypto.randomUUID(), state = Crypto.randomUUID();
  try {
    if (!appleAuth.isSupported) throw new Error('Apple sign-in is unavailable on this device.');
    const result = await appleAuth.performRequest({ requestedOperation: appleAuth.Operation.LOGIN, requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL], nonce, state });
    if (!result.identityToken || result.state !== state) throw new Error('Apple sign-in could not be verified. Please try again.');
    return { credential: new OAuthProvider('apple.com').credential({ idToken: result.identityToken, rawNonce: nonce }),
      ...(result.authorizationCode ? { apple: { token: result.authorizationCode, type: 'CODE' as const } } : {}) };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === appleAuth.Error.CANCELED) throw cancelled();
    throw error;
  }
}
