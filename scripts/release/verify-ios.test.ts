/** @file Exercises iOS inspection failures with synthetic archive metadata; no signing or provider calls. */
import { expect, it } from 'vitest';
import { inspectIosMetadata, requireIosInspectionHost } from './verify-ios';
const info = { DTSDKName: 'iphoneos26.4', DTXcode: '2640', NSMicrophoneUsageDescription: 'Record a prompt.', NSPhotoLibraryUsageDescription: 'Choose a tile photo.' };
const entitlements = { 'application-identifier': 'SYNTHETIC.net.darkmachines.littlesay', 'com.apple.developer.applesignin': ['Default'], 'get-task-allow': false };
const provisioning = { Entitlements: entitlements, ExpirationDate: '2030-01-01T00:00:00Z' };
const manifests = ['ExpoModulesCore_privacy.bundle/PrivacyInfo.xcprivacy'];
const now = Date.parse('2026-10-09T00:00:00Z');
it('fails wrong hosts before requiring Apple tools', () => {
  expect(() => requireIosInspectionHost('win32')).toThrow('requires macOS');
  expect(() => requireIosInspectionHost('darwin')).not.toThrow();
});
it('distinguishes store and ad hoc and reports remaining assessments without profile contents', () => {
  const report = inspectIosMetadata(info, entitlements, provisioning, 'production', manifests, now);
  expect(report.distribution).toBe('store'); expect(report.pending).toContain('Export compliance assessment');
  expect(JSON.stringify(report)).not.toContain('SYNTHETIC');
  expect(inspectIosMetadata(info, entitlements, { ...provisioning, ProvisionedDevices: ['synthetic-device'] }, 'internal', manifests, now).distribution).toContain('not TestFlight');
  expect(() => inspectIosMetadata(info, entitlements, { ...provisioning, ProvisionedDevices: ['synthetic-device'] }, 'production', manifests, now)).toThrow('Signing distribution');
});
it('rejects unsupported toolchains, missing configuration and mismatched signed identity', () => {
  for (const patch of [{ DTXcode: '2630' }, { DTSDKName: 'iphoneos25.0' }, { DTSDKName: '' }]) expect(() => inspectIosMetadata({ ...info, ...patch }, entitlements, provisioning, 'production', manifests, now)).toThrow('Xcode 26.4');
  expect(() => inspectIosMetadata({ ...info, DTSDKName: 'iphoneos27.0', DTXcode: '2700' }, entitlements, provisioning, 'production', manifests, now)).toThrow('scene opt-in');
  expect(() => inspectIosMetadata({ ...info, DTSDKName: 'iphoneos27.0', DTXcode: '2700', UIApplicationSceneManifest: { UISceneConfigurations: {} } }, entitlements, provisioning, 'production', manifests, now)).toThrow('scene opt-in');
  expect(() => inspectIosMetadata({ ...info, NSMicrophoneUsageDescription: '' }, entitlements, provisioning, 'production', manifests, now)).toThrow('microphone');
  expect(() => inspectIosMetadata(info, { ...entitlements, 'application-identifier': 'OTHER.net.darkmachines.littlesay' }, provisioning, 'production', manifests, now)).toThrow('identifier');
  expect(() => inspectIosMetadata(info, entitlements, provisioning, 'production', [], now)).toThrow('PrivacyInfo');
  expect(() => inspectIosMetadata(info, entitlements, { ...provisioning, ExpirationDate: '2020-01-01' }, 'production', manifests, now)).toThrow('expired');
  expect(() => inspectIosMetadata(info, entitlements, { ...provisioning, ProvisionsAllDevices: true }, 'production', manifests, now)).toThrow('Enterprise');
});
