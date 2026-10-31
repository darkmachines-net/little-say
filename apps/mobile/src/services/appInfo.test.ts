/** @file Verifies About identifies the running release, native binary, and OTA update without confusing web or Expo Go host builds. */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getAppInfo } from './appInfo';
import { getAppInfo as getWebAppInfo } from './appInfo.web';

const metadata = vi.hoisted(() => ({
  constants: { executionEnvironment: 'standalone', expoConfig: { version: '1.2.0', extra: { releaseVersion: '1.2.3' } } } as any,
  application: { nativeApplicationVersion: '1.2.0', nativeBuildVersion: '42' } as any,
  updates: { isEnabled: true, channel: 'production', runtimeVersion: '1', isEmbeddedLaunch: false, updateId: '8f86d2e5-20ef-4827-977a-e658bf6a7952' } as any,
}));
vi.mock('expo-constants', () => ({ default: metadata.constants, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
vi.mock('expo-application', () => metadata.application);
vi.mock('expo-updates', () => metadata.updates);

beforeEach(() => {
  vi.stubGlobal('__DEV__', false);
  metadata.constants.executionEnvironment = 'standalone';
  metadata.constants.expoConfig = { version: '1.2.0', extra: { releaseVersion: '1.2.3' } };
  Object.assign(metadata.application, { nativeApplicationVersion: '1.2.0', nativeBuildVersion: '42' });
  Object.assign(metadata.updates, { isEnabled: true, channel: 'production', runtimeVersion: '1', isEmbeddedLaunch: false, updateId: '8f86d2e5-20ef-4827-977a-e658bf6a7952' });
});
afterEach(() => vi.unstubAllGlobals());

it('distinguishes an active OTA release from its older installed binary and EAS build counter', () => {
  // Manifest counters need not match the independently managed native build counter.
  metadata.constants.expoConfig.ios = { buildNumber: '5' };
  metadata.constants.expoConfig.android = { versionCode: 5 };
  expect(getAppInfo()).toEqual({
    version: '1.2.3', environment: 'Release build', nativeVersion: '1.2.0', buildNumber: '42',
    channel: 'production', runtimeVersion: '1', updateSource: 'Downloaded update', updateId: metadata.updates.updateId,
  });
});

it('identifies an embedded release without inventing an update ID', () => {
  metadata.updates.isEmbeddedLaunch = true;
  metadata.updates.updateId = null;
  expect(getAppInfo().updateSource).toBe('Included with app');
  expect(getAppInfo().updateId).toBeUndefined();
});

it('labels Expo Go and excludes the host application version and build number', () => {
  metadata.constants.executionEnvironment = 'storeClient';
  expect(getAppInfo()).toEqual({ version: '1.2.3', environment: 'Expo Go' });
});

it('labels development builds and omits inactive release-update metadata', () => {
  vi.stubGlobal('__DEV__', true);
  expect(getAppInfo()).toEqual({ version: '1.2.3', environment: 'Development build', nativeVersion: '1.2.0', buildNumber: '42' });
});

it('handles disabled updates and missing native metadata without substituting manifest counters', () => {
  metadata.updates.isEnabled = false;
  metadata.application.nativeApplicationVersion = null;
  metadata.application.nativeBuildVersion = null;
  expect(getAppInfo()).toEqual({ version: '1.2.3', environment: 'Release build', nativeVersion: 'Unavailable', buildNumber: 'Unavailable' });
});

it('falls back to Expo version and handles missing configuration on both platforms', () => {
  delete metadata.constants.expoConfig.extra;
  expect(getAppInfo().version).toBe('1.2.0');
  expect(getWebAppInfo().version).toBe('1.2.0');
  metadata.constants.expoConfig = null;
  expect(getAppInfo().version).toBe('Unavailable');
  expect(getWebAppInfo().version).toBe('Unavailable');
});

it('reports only the loaded web release, regardless of available native host metadata', () => {
  expect(getWebAppInfo()).toEqual({ version: '1.2.3', environment: 'Web' });
  vi.stubGlobal('__DEV__', true);
  expect(getWebAppInfo()).toEqual({ version: '1.2.3', environment: 'Web development' });
});
