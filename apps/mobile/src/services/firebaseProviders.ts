/** @file Lazily loads native Google/Apple modules only in development or release builds, preserving Expo Go startup. */
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
/** Obtain a provider credential without changing Firebase accounts; callers decide sign-in/link/reauthentication. */
export async function nativeCredential(provider: SocialProvider, config: AuthConfig): Promise<ProviderCredential> {
  if (!socialAuthAvailable()) throw new Error('Google and Apple sign-in require a development build. Email sign-in works in Expo Go.');
  if (provider === 'google.com') {
    if (!config.googleWebClientId) throw new Error('Google native sign-in is not configured on this server.');
    const { GoogleOneTapSignIn, isSuccessResponse, isNoSavedCredentialFoundResponse } = await import('react-native-nitro-google-signin');
    GoogleOneTapSignIn.configure({ webClientId: config.googleWebClientId, ...(config.googleIosClientId ? { iosClientId: config.googleIosClientId } : {}) });
    await GoogleOneTapSignIn.checkPlayServices();
    let response = await GoogleOneTapSignIn.signIn();
    if (isNoSavedCredentialFoundResponse(response)) response = await GoogleOneTapSignIn.createAccount();
    if (!isSuccessResponse(response) || !response.data.idToken) throw new Error('Google sign-in was cancelled.');
    return { credential: GoogleAuthProvider.credential(response.data.idToken) };
  }
  const { appleAuth, appleAuthAndroid } = await import('@invertase/react-native-apple-authentication');
  const nonce = Crypto.randomUUID(), state = Crypto.randomUUID();
  if (Platform.OS === 'ios') {
    const result = await appleAuth.performRequest({ requestedOperation: appleAuth.Operation.LOGIN, requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL], nonce, state });
    if (!result.identityToken) throw new Error('Apple sign-in was cancelled.');
    return { credential: new OAuthProvider('apple.com').credential({ idToken: result.identityToken, rawNonce: nonce }),
      ...(result.authorizationCode ? { apple: { token: result.authorizationCode, type: 'CODE' as const } } : {}) };
  }
  if (!config.appleServiceId || !config.appleRedirectUri) throw new Error('Apple Android sign-in is not configured on this server.');
  appleAuthAndroid.configure({ clientId: config.appleServiceId, redirectUri: config.appleRedirectUri, responseType: appleAuthAndroid.ResponseType.ALL, scope: appleAuthAndroid.Scope.ALL, nonce, state });
  const result = await appleAuthAndroid.signIn();
  if (!result.id_token || result.state !== state) throw new Error('Apple sign-in was cancelled or could not be verified.');
  return { credential: new OAuthProvider('apple.com').credential({ idToken: result.id_token, rawNonce: nonce }),
    ...(result.code ? { apple: { token: result.code, type: 'CODE' as const, redirectUri: config.appleRedirectUri } } : {}) };
}
