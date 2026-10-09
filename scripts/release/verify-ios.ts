/** @file Checks an iOS archive against signing, bundle identity, and Expo update settings on macOS. */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { assert, run } from './common';
import type { NativeRelease, Profile } from './native-contract';

/** Reject non-Mac artifact inspection before launching native tools. Does not build or contact providers. */
export function requireIosInspectionHost(host = process.platform) {
  assert(host === 'darwin', 'iOS archive inspection requires macOS with Xcode tools. No build or upload was attempted.');
}

/** Check decoded archive metadata; report only public configuration, never the provisioning document.
 * Toolchain fields describe the artifact, not the inspector's installed Xcode. Scene support is
 * required for iOS 27 SDK artifacts; this verifier cannot prove their runtime behavior.
 */
export function inspectIosMetadata(info: Record<string, any>, entitlements: Record<string, any>, provisioning: Record<string, any>, profile: Profile, manifests: string[], now = Date.now()) {
  assert(profile === 'internal' || profile === 'production', 'Choose internal (ad hoc) or production (store/TestFlight).');
  const sdk = /^iphoneos(\d+)\.(\d+)/.exec(String(info.DTSDKName ?? ''));
  const xcode = Number(info.DTXcode);
  assert(sdk && Number(sdk[1]) >= 26 && Number.isInteger(xcode) && xcode >= 2640, 'Archive must identify an iOS 26+ SDK and Xcode 26.4+ for Expo SDK 57.');
  const scenes = info.UIApplicationSceneManifest?.UISceneConfigurations;
  const hasSceneDelegate = scenes && Object.values(scenes).some(entries => Array.isArray(entries) && entries.some(entry => typeof entry?.UISceneDelegateClassName === 'string' && entry.UISceneDelegateClassName.trim()));
  assert(Number(sdk[1]) < 27 || hasSceneDelegate, 'An iOS 27 SDK archive requires SDK 57 scene opt-in and a fresh native runtime validation.');
  assert(typeof info.NSMicrophoneUsageDescription === 'string' && info.NSMicrophoneUsageDescription.trim(), 'Archive is missing its microphone purpose string.');
  assert(typeof info.NSPhotoLibraryUsageDescription === 'string' && info.NSPhotoLibraryUsageDescription.trim(), 'Archive is missing its photo-library purpose string.');
  assert(Array.isArray(entitlements['com.apple.developer.applesignin']) && entitlements['com.apple.developer.applesignin'].includes('Default'), 'Archive is missing the intended Apple sign-in entitlement.');
  const appId = entitlements['application-identifier'];
  assert(typeof appId === 'string' && appId.endsWith('.net.darkmachines.littlesay') && provisioning.Entitlements?.['application-identifier'] === appId, 'Signed application identifier differs from the provisioning profile or bundle identity.');
  assert(entitlements['get-task-allow'] !== true && provisioning.Entitlements?.['get-task-allow'] !== true, 'Development signing is not a distribution build.');
  assert(Number.isFinite(Date.parse(provisioning.ExpirationDate)) && Date.parse(provisioning.ExpirationDate) > now, 'Provisioning profile is expired or has no readable expiration.');
  assert(!provisioning.ProvisionsAllDevices, 'Enterprise distribution is not the selected ad hoc/store profile.');
  const devices = provisioning.ProvisionedDevices;
  assert(profile === 'internal' ? Array.isArray(devices) && devices.length > 0 : devices === undefined, 'Signing distribution differs from the selected profile: EAS internal is ad hoc; TestFlight requires production/store.');
  assert(manifests.length > 0, 'No PrivacyInfo.xcprivacy was found in the extracted application; inspect generated SDK/app manifests before distribution.');
  return { sdk: info.DTSDKName as string, xcode, distribution: profile === 'internal' ? 'ad hoc (not TestFlight)' : 'store', permissions: { microphone: info.NSMicrophoneUsageDescription as string, photos: info.NSPhotoLibraryUsageDescription as string }, privacyManifests: manifests,
    pending: ['Required-reason API and SDK manifest content assessment', 'App Store privacy labels', 'Export compliance assessment', 'Signed provider and device behavior'] };
}

/**
 * Extract and verify the single app in an IPA, including version and OTA project/runtime/channel;
 * always remove temporary extracted files.
 */
export function verifyIosArtifact(file: string, release: NativeRelease, profile: Profile) {
  requireIosInspectionHost();
  const temp = mkdtempSync(resolve(tmpdir(), 'little-say-ipa-'));
  try {
    run('ditto', ['-x', '-k', file, temp], { capture: true });
    const payload = resolve(temp, 'Payload');
    const apps = readdirSync(payload).filter(file => file.endsWith('.app'));
    assert(apps.length === 1, 'Expected exactly one iOS application in the IPA.');
    const app = resolve(payload, apps[0]);
    run('codesign', ['--verify', '--deep', '--strict', app], { capture: true });
    const plist = (file: string) => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', resolve(app, file)], { capture: true }));
    const info = plist('Info.plist'); const updates = plist('Expo.plist');
    assert(info.CFBundleIdentifier === 'net.darkmachines.littlesay' && info.CFBundleShortVersionString === release.version && info.CFBundleVersion === release.iosBuildNumber, 'IPA application identity/version differs from the release contract.');
    assert(updates.EXUpdatesURL === `https://u.expo.dev/${release.expoProjectId}` && updates.EXUpdatesRuntimeVersion === release.version && updates.EXUpdatesRequestHeaders?.['expo-channel-name'] === profile, 'IPA update project/runtime/channel differs from the release contract.');
    const decode = (input: string) => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', '-'], { capture: true, input }));
    const entitlements = decode(run('codesign', ['-d', '--entitlements', ':-', app], { capture: true }));
    const profileXml = run('security', ['cms', '-D', '-i', resolve(app, 'embedded.mobileprovision')], { capture: true });
    // A full provisioning plist contains dates/certificates that cannot be converted to JSON.
    // Extract only the fields used here; never print the profile or its device/certificate contents.
    const extract = (key: string, format = 'json') => run('plutil', ['-extract', key, format, '-o', '-', '-'], { capture: true, input: profileXml });
    const optional = (key: string) => new RegExp(`<key>\\s*${key}\\s*</key>`).test(profileXml) ? JSON.parse(extract(key)) : undefined;
    const provisioning = { Entitlements: JSON.parse(extract('Entitlements')), ExpirationDate: extract('ExpirationDate', 'raw'), ProvisionedDevices: optional('ProvisionedDevices'), ProvisionsAllDevices: optional('ProvisionsAllDevices') };
    const manifests: string[] = [];
    const visit = (directory: string, prefix = '') => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (entry.isDirectory()) visit(resolve(directory, entry.name), name + '/');
        else if (entry.isFile() && entry.name === 'PrivacyInfo.xcprivacy') manifests.push(name);
      }
    };
    visit(app);
    const report = inspectIosMetadata(info, entitlements, provisioning, profile, manifests.sort());
    console.log(JSON.stringify(report, null, 2));
    return report;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
