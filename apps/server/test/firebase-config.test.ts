/** @file Verifies Google/email discovery, stale Apple configuration filtering, and retained legacy revocation settings. */
import { expect, it } from 'vitest';
import { firebaseConfig } from '../src/accounts/firebase';

const hosted = { NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'hosted-little-say', FIREBASE_API_KEY: 'public-key', FIREBASE_APP_ID: 'public-app' };

it('advertises Google and email by default without Apple setup', () => {
  expect(firebaseConfig(hosted).providers).toEqual(['password', 'google.com']);
});

it('ignores Apple in older deployment settings while retaining the legacy callback for revocation', () => {
  const config = firebaseConfig({ ...hosted, FIREBASE_AUTH_PROVIDERS: 'password, google.com, apple.com', FIREBASE_APPLE_SERVICE_ID: 'legacy.auth', FIREBASE_APPLE_REDIRECT_URI: 'https://hosted-little-say.firebaseapp.com/__/auth/handler' });
  expect(config.providers).toEqual(['password', 'google.com']);
  expect(config.appleRedirectUri).toBe('https://hosted-little-say.firebaseapp.com/__/auth/handler');
});

it('does not silently enable Google when the operator selects email only', () => {
  expect(firebaseConfig({ ...hosted, FIREBASE_AUTH_PROVIDERS: 'password,apple.com' }).providers).toEqual(['password']);
});
