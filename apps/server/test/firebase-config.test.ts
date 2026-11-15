/** @file Verifies Google/email discovery, explicit provider selection, and rejection of unsupported auth configuration. */
import { expect, it } from 'vitest';
import { firebaseConfig } from '../src/accounts/firebase';

const hosted = { NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'hosted-little-say', FIREBASE_API_KEY: 'public-key', FIREBASE_APP_ID: 'public-app' };

it('advertises Google and email by default without Apple setup', () => {
  expect(firebaseConfig(hosted).providers).toEqual(['password', 'google.com']);
});

it('rejects unsupported auth providers', () => {
  expect(() => firebaseConfig({ ...hosted, FIREBASE_AUTH_PROVIDERS: 'password,apple.com' })).toThrow();
});

it('does not silently enable Google when the operator selects email only', () => {
  expect(firebaseConfig({ ...hosted, FIREBASE_AUTH_PROVIDERS: 'password' }).providers).toEqual(['password']);
});
