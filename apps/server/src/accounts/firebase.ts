/** @file Verifies registered Firebase identities, exposes public client settings, and prepares a development-only emulator account. */
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth';
import { authConfigSchema, type AuthConfig } from '@little-say/core';
import { AccountError, type Identity } from './store';

export const COOKIE_SECONDS = 14 * 86400;
export interface IdentityService {
  readonly config: AuthConfig;
  /** Verify a current ID token or browser cookie, checking revocation and disabled users. */
  verify(token: string, cookie?: boolean): Promise<Identity>;
  /** Mint a browser session after recent Firebase authentication. */
  cookie(token: string): Promise<string>;
  /** Delete the shared identity; absence is successful for idempotent retries. */
  deleteUser(uid: string): Promise<void>;
  /** Revoke a freshly obtained Apple grant before deleting its Firebase identity. */
  revokeApple(idToken: string, grant: { token: string; type: 'CODE' | 'ACCESS_TOKEN'; redirectUri?: string }): Promise<void>;
  /** Release the Admin app after requests and deletion work drain. */
  close(): Promise<void>;
}

/** Validate hosted auth settings; only development emulators advertise public test credentials, never production. */
export function firebaseConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const emulator = env.FIREBASE_AUTH_EMULATOR_HOST;
  if (env.NODE_ENV === 'production' && (emulator || env.FIREBASE_AUTH_EMULATOR_URL)) throw new Error('Firebase emulation is forbidden in production.');
  if (emulator && (!/^[a-zA-Z0-9.\-[\]:]+:\d+$/.test(emulator) || emulator.includes('://'))) throw new Error('FIREBASE_AUTH_EMULATOR_HOST must be host:port without a protocol.');
  const projectId = env.FIREBASE_PROJECT_ID || (emulator ? 'demo-little-say' : '');
  if (!projectId || (emulator && !projectId.startsWith('demo-')) || (!emulator && projectId.startsWith('demo-'))) throw new Error('Configure a hosted FIREBASE_PROJECT_ID or use a demo- project with the emulator.');
  const providers = (env.FIREBASE_AUTH_PROVIDERS || (emulator ? 'password' : 'password,google.com,apple.com')).split(',').map((value: string) => value.trim());
  const config = authConfigSchema.parse({ projectId, apiKey: env.FIREBASE_API_KEY || (emulator ? 'demo-key' : ''), appId: env.FIREBASE_APP_ID || (emulator ? 'demo-app' : ''), authDomain: env.FIREBASE_AUTH_DOMAIN || projectId + '.firebaseapp.com', providers,
    ...(emulator ? { emulatorUrl: env.FIREBASE_AUTH_EMULATOR_URL || 'http://' + emulator } : {}),
    ...(emulator && env.NODE_ENV === 'development' && providers.includes('password') ? { developmentAccount: { email: 'tester@little-say.test', password: 'little-say-local-test-only' } } : {}),
    googleWebClientId: env.FIREBASE_GOOGLE_WEB_CLIENT_ID, googleIosClientId: env.FIREBASE_GOOGLE_IOS_CLIENT_ID,
    appleServiceId: env.FIREBASE_APPLE_SERVICE_ID, appleRedirectUri: env.FIREBASE_APPLE_REDIRECT_URI });
  if (!config.apiKey || !config.appId) throw new Error('Configure the public Firebase web app API key and app ID.');
  if (config.emulatorUrl) { const url = new URL(config.emulatorUrl); if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/') throw new Error('Use an HTTP emulator origin.'); }
  return config;
}

/** Own a named Admin app using ADC in hosted environments and no credentials in the emulator. */
export class FirebaseIdentity implements IdentityService {
  private app;
  private auth: Auth;
  readonly config: AuthConfig;
  /** Create isolated Admin state; Firebase reads the explicit emulator environment before initialization. */
  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.config = firebaseConfig(env);
    if (env.FIREBASE_AUTH_EMULATOR_HOST !== process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Set the Firebase emulator environment on the server process before initialization.');
    this.app = initializeApp({ projectId: this.config.projectId, ...(this.config.emulatorUrl ? {} : { credential: applicationDefault() }), httpAgent: undefined }, 'little-say-' + crypto.randomUUID());
    this.auth = getAuth(this.app);
  }
  /** Create the verified local test login if absent; preserve its UID and data across development API restarts. */
  async prepareDevelopmentAccount() {
    const account = this.config.developmentAccount;
    if (!this.config.emulatorUrl || !account) return;
    try { await this.auth.createUser({ ...account, emailVerified: true, displayName: 'Test account' }); }
    catch (error) { if ((error as { code?: string }).code !== 'auth/email-already-exists') throw error; }
  }
  /** Verify token/cookie claims and reject anonymous, disabled, or revoked identities before granting account access. */
  async verify(token: string, cookie = false): Promise<Identity> {
    try {
      const claims: DecodedIdToken = cookie ? await this.auth.verifySessionCookie(token, true) : await this.auth.verifyIdToken(token, true);
      const user = await this.auth.getUser(claims.uid);
      if (user.disabled || claims.firebase.sign_in_provider === 'anonymous' || !user.providerData.length) throw new Error('A registered account is required.');
      return { project: this.config.projectId, uid: claims.uid, email: user.email ?? null, displayName: user.displayName ?? null, emailVerified: user.emailVerified,
        providers: user.providerData.map(value => value.providerId), authTime: claims.auth_time, expires: claims.exp };
    } catch { throw new AccountError('Sign in again. Your local boards are safe.', 401); }
  }
  /** Create a two-week cookie; callers verify recent auth and CSRF before invoking this operation. */
  async cookie(token: string) { return this.auth.createSessionCookie(token, { expiresIn: COOKIE_SECONDS * 1000 }); }
  /** Delete globally; retries tolerate an identity already removed by an earlier attempt. */
  async deleteUser(uid: string) {
    try { await this.auth.deleteUser(uid); } catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') throw error; }
  }
  /** Revoke Apple access through Firebase without persisting or logging the short-lived grant. */
  async revokeApple(idToken: string, grant: { token: string; type: 'CODE' | 'ACCESS_TOKEN'; redirectUri?: string }) {
    if (this.config.emulatorUrl) return;
    if (grant.redirectUri && grant.redirectUri !== this.config.appleRedirectUri) throw new AccountError('Apple reauthentication callback does not match this server.', 400);
    const response = await fetch('https://identitytoolkit.googleapis.com/v2/accounts:revokeToken?key=' + encodeURIComponent(this.config.apiKey), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ providerId: 'apple.com', tokenType: grant.type, token: grant.token, idToken, ...(grant.redirectUri ? { redirectUri: grant.redirectUri } : {}) }),
    });
    if (!response.ok) throw new AccountError('Apple authorization could not be revoked. Reauthenticate and try again.', 502);
  }
  /** Delete the owned Admin app after request processing ends. */
  async close() { await deleteApp(this.app); }
}
