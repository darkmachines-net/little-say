/** @file Verifies honest public provider availability across browser, Expo Go, and native configurations. */
import { expect, it } from 'vitest';
import type { AuthConfig } from '@little-say/core';
import { providerUnavailable } from './providerAvailability';
const config: AuthConfig = { projectId: 'demo-test', apiKey: 'public', appId: 'app', authDomain: 'example.test', providers: ['password', 'google.com', 'apple.com'] };
it('keeps browser providers independent of native OAuth client fields', () => {
  expect(providerUnavailable('google.com', config, 'web', true)).toBeNull();
  expect(providerUnavailable('apple.com', config, 'web', true)).toBeNull();
});
it('explains missing configuration and advertised-provider restrictions', () => {
  expect(providerUnavailable('apple.com', null, 'ios', true)).toContain('retry');
  expect(providerUnavailable('apple.com', { ...config, providers: ['password'] }, 'ios', true)).toContain('not enabled');
  expect(providerUnavailable('apple.com', config, 'ios', false)).toContain('development or release build');
});
it('requires native Google client IDs and Android Apple callbacks without blocking iOS Apple', () => {
  expect(providerUnavailable('google.com', config, 'android', true)).toContain('client configuration');
  const google = { ...config, googleWebClientId: 'public-web-client' };
  expect(providerUnavailable('google.com', google, 'android', true)).toBeNull();
  expect(providerUnavailable('google.com', google, 'ios', true)).toContain('client configuration');
  expect(providerUnavailable('google.com', { ...google, googleIosClientId: 'public-ios-client' }, 'ios', true)).toBeNull();
  expect(providerUnavailable('apple.com', config, 'android', true)).toContain('callback configuration');
  expect(providerUnavailable('apple.com', { ...config, appleServiceId: 'service', appleRedirectUri: 'https://example.test/callback' }, 'android', true)).toBeNull();
  expect(providerUnavailable('apple.com', config, 'ios', true)).toBeNull();
});
