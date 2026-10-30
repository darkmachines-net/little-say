/** @file Coordinates explicit Firebase sign-in, backend cookie exchange, provider linking, and fresh native ID tokens. */
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { initializeApp } from 'firebase/app';
import { initializeAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, signInWithCredential, signOut, sendEmailVerification, sendPasswordResetEmail, reload, getIdToken, GoogleAuthProvider, OAuthProvider, EmailAuthProvider, linkWithCredential, linkWithPopup, type User, type Auth } from 'firebase/auth';
import { authConfigSchema, sessionSchema, type AuthConfig } from '@little-say/core';
import { apiFetch } from './api';
import { authDependencies } from './firebasePersistence';
import { nativeCredential, socialAuthAvailable, type SocialProvider, type AppleGrant } from './firebaseProviders';
import { type AccountSession } from './accountSession';
export type Provider = 'password' | SocialProvider;
type Context = { auth: Auth; config: AuthConfig };
const contexts = new Map<string, Promise<Context>>();
const providerObject = (provider: SocialProvider) => {
  if (provider === 'google.com') return new GoogleAuthProvider();
  const apple = new OAuthProvider('apple.com'); apple.addScope('email'); apple.addScope('name'); return apple;
};

/** Resolve public backend configuration only after the parent requests account functionality. */
export async function accountContext(server: string, savedConfig?: AuthConfig): Promise<Context> {
  let context = contexts.get(server);
  if (!context) {
    context = (async () => {
      const config = savedConfig ?? authConfigSchema.parse(await apiFetch(server, '/api/account/config', {}, undefined, true));
      const name = 'little-say-' + await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, server);
      const auth = initializeAuth(initializeApp(config, name), authDependencies());
      if (config.emulatorUrl) connectAuthEmulator(auth, config.emulatorUrl, { disableWarnings: true });
      await auth.authStateReady();
      return { auth, config };
    })();
    contexts.set(server, context);
    context.catch(() => { contexts.delete(server); });
  }
  return context;
}

/** Fetch the server-side CSRF token bound to the sole opaque browser session cookie. */
export async function csrfHeaders(server: string): Promise<Record<string, string>> {
  if (Platform.OS !== 'web') return {};
  const result = await apiFetch(server, '/api/account/csrf', { credentials: 'include' }, undefined, true);
  return { 'X-Little-Say-CSRF': result.csrfToken };
}

async function rawSignIn(context: Context, provider: Provider, email: string, password: string): Promise<{ user: User; apple?: AppleGrant }> {
  if (!context.config.providers.includes(provider)) throw new Error('This sign-in method is not available in Little Say.');
  if (provider === 'password') return signInWithEmailAndPassword(context.auth, email.trim(), password);
  if (Platform.OS !== 'web') {
    const credential = await nativeCredential(provider, context.config);
    return { ...(await signInWithCredential(context.auth, credential.credential)), apple: credential.apple };
  }
  const result = await signInWithPopup(context.auth, providerObject(provider));
  const accessToken = provider === 'apple.com' ? OAuthProvider.credentialFromResult(result)?.accessToken : undefined;
  return { user: result.user, ...(accessToken ? { apple: { token: accessToken, type: 'ACCESS_TOKEN' as const } } : {}) };
}

async function exchange(server: string, context: Context, user: User): Promise<AccountSession> {
  const result = sessionSchema.parse(await apiFetch(server, '/api/account/session', { credentials: 'include', method: 'POST',
    headers: { 'Content-Type': 'application/json', ...await csrfHeaders(server) },
    body: JSON.stringify({ idToken: await getIdToken(user, true), native: Platform.OS !== 'web' }) }, undefined, true));
  const session = { account: result.account, server, firebaseUid: user.uid, authConfig: context.config };
  if (Platform.OS === 'web') await signOut(context.auth);
  return session;
}

/** Sign in or register only after explicit consent to connect this device's boards to the selected server. */
export async function authenticateAccount(server: string, mode: 'login' | 'register', email: string, password: string, provider: Provider = 'password') {
  const context = await accountContext(server);
  try {
    const result = mode === 'register' && provider === 'password' ? await createUserWithEmailAndPassword(context.auth, email.trim(), password) : await rawSignIn(context, provider, email, password);
    if (mode === 'register' && !result.user.emailVerified) await sendEmailVerification(result.user);
    return await exchange(server, context, result.user);
  } finally { if (Platform.OS === 'web') await signOut(context.auth); }
}

/** Send a non-enumerating reset message through Firebase's configured email action handler. */
export async function resetAccountPassword(server: string, email: string) {
  const context = await accountContext(server);
  try { await sendPasswordResetEmail(context.auth, email.trim()); }
  catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') throw error; }
}

/** Return fresh native authentication bound to the opted-in backend and expected Firebase UID. */
export async function accountAuthHeaders(session: AccountSession, mutation: boolean): Promise<Record<string, string>> {
  if (Platform.OS === 'web') return mutation ? csrfHeaders(session.server) : {};
  const context = await accountContext(session.server, session.authConfig);
  const user = context.auth.currentUser;
  if (!user || user.uid !== session.firebaseUid) throw new Error('Sign in again to sync. Your local boards are still available.');
  return { Authorization: 'Bearer ' + await getIdToken(user) };
}

/** Clear this device's Firebase state without affecting other devices or local boards. */
export async function signOutAccount(session: AccountSession) {
  const context = await accountContext(session.server, session.authConfig);
  await signOut(context.auth);
}

async function reauthenticate(session: AccountSession, provider: Provider, password: string) {
  const context = await accountContext(session.server, session.authConfig);
  const result = await rawSignIn(context, provider, session.account.email ?? '', password);
  if (result.user.uid !== session.firebaseUid) { await signOut(context.auth); throw new Error('Use the same account to complete this action.'); }
  return { context, ...result };
}

/** Reauthenticate to resend verification, then refresh the cookie/profile after verification was completed. */
export async function verifyAccountEmail(session: AccountSession, password: string, resend: boolean, provider: Provider = 'password') {
  const { context, user } = await reauthenticate(session, provider, password);
  try { await reload(user); if (resend && !user.emailVerified) await sendEmailVerification(user); return await exchange(session.server, context, user); }
  finally { if (Platform.OS === 'web') await signOut(context.auth); }
}

/** Link a credential to the verified existing UID; conflicts never merge backups by email. */
export async function linkAccountProvider(session: AccountSession, target: Provider, email: string, newPassword: string, currentProvider: Provider, password: string) {
  const { context, user } = await reauthenticate(session, currentProvider, password);
  try {
    if (!context.config.providers.includes(target)) throw new Error('This sign-in method is not available in Little Say.');
    if (target === 'password') await linkWithCredential(user, EmailAuthProvider.credential(email.trim(), newPassword));
    else if (Platform.OS === 'web') await linkWithPopup(user, providerObject(target));
    else await linkWithCredential(user, (await nativeCredential(target, context.config)).credential);
    return await exchange(session.server, context, user);
  } finally { if (Platform.OS === 'web') await signOut(context.auth); }
}

/** Reauthenticate the exact identity and return short-lived proof for the backend deletion request. */
export async function accountDeletionProof(session: AccountSession, provider: Provider, password: string) {
  const { context, user, apple } = await reauthenticate(session, session.account.providers.includes('apple.com') ? 'apple.com' : provider, password);
  try { return { idToken: await getIdToken(user, true), ...(apple ? { apple } : {}) }; }
  finally { if (Platform.OS === 'web') await signOut(context.auth); }
}

/** Explain provider conflicts without displaying Firebase implementation details in account flows. */
export function accountError(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (['auth/account-exists-with-different-credential', 'auth/credential-already-in-use', 'auth/email-already-in-use'].includes(code ?? '')) return 'Sign in with the method already associated with this account, then link the additional method in Account & backup.';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(code ?? '')) return 'Check your email and sign-in details, then try again.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in was cancelled. Your local boards are unchanged.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Try again shortly.';
  if (code?.startsWith('auth/')) return 'Sign-in could not complete. Check your connection and try again.';
  return error instanceof Error ? error.message : 'Account service is unavailable. Your local boards are unchanged.';
}
export { socialAuthAvailable };
