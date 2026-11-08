/** @file Verifies store/development Google callback selection and Apple entitlements match the native application identity. */
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const configure = require('../apps/mobile/app.config.js');
const base = require('../apps/mobile/app.json').expo;
afterEach(() => { vi.unstubAllEnvs(); });

it.each(['development', 'release'])('selects the %s Google iOS callback while preserving Apple capability', variant => {
  vi.stubEnv('EXPO_RELEASE_VARIANT', variant); vi.stubEnv('LITTLE_SAY_CHANNEL', 'beta');
  vi.stubEnv('LITTLE_SAY_GOOGLE_IOS_URL_SCHEME', 'com.googleusercontent.apps.store-client');
  vi.stubEnv('LITTLE_SAY_GOOGLE_IOS_DEVELOPMENT_URL_SCHEME', 'com.googleusercontent.apps.dev-client');
  const config = configure({ config: base });
  const scheme = `com.googleusercontent.apps.${variant === 'development' ? 'dev' : 'store'}-client`;
  expect(config.plugins).toContainEqual(['react-native-nitro-google-signin', { iosUrlScheme: scheme }]);
  expect(config.extra.googleIosUrlScheme).toBe(scheme);
  expect(config.ios.bundleIdentifier).toBe(`net.darkmachines.littlesay${variant === 'development' ? '.development' : ''}`);
  expect(config.ios.usesAppleSignIn).toBe(true);
  expect(config.ios.entitlements['com.apple.developer.applesignin']).toEqual(['Default']);
});

it('does not reuse the store callback when development OAuth is unconfigured', () => {
  vi.stubEnv('EXPO_RELEASE_VARIANT', 'development'); vi.stubEnv('LITTLE_SAY_CHANNEL', 'beta');
  vi.stubEnv('LITTLE_SAY_GOOGLE_IOS_URL_SCHEME', 'com.googleusercontent.apps.store-client');
  vi.stubEnv('LITTLE_SAY_GOOGLE_IOS_DEVELOPMENT_URL_SCHEME', '');
  const config = configure({ config: base });
  expect(config.extra.googleIosUrlScheme).toBe('');
  expect(config.plugins.some((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'react-native-nitro-google-signin')).toBe(false);
});
