/** @file Obtains Google Firebase credentials through native dialogs while isolating Expo Go and clearing native account selection. */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { GoogleAuthProvider, type AuthCredential } from 'firebase/auth';
import { type AuthConfig } from '@little-say/core';
export type SocialProvider = 'google.com';
export type ProviderCredential = { credential: AuthCredential };
/** Expo Go supports email authentication; the native Google module requires a custom binary. */
export function socialAuthAvailable() { return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient; }
/**
 * Obtain a Google credential for sign-in, linking, or fresh identity confirmation without changing Firebase accounts.
 * Native SDKs load only in custom builds; cancellation rejects with auth/user-cancelled.
 */
export async function nativeCredential(provider: SocialProvider, config: AuthConfig): Promise<ProviderCredential> {
  if (provider !== 'google.com') throw new Error('This sign-in method is not available in Little Say.');
  if (!socialAuthAvailable()) throw new Error('Google sign-in requires a development build. Email sign-in works in Expo Go.');
  return googleCredential(config);
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
