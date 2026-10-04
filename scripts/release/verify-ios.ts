/** @file Checks an iOS archive against signing, bundle identity, and Expo update settings on macOS. */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { assert, run } from './common';
import type { NativeRelease, Profile } from './native-contract';

/**
 * Extract and verify the single app in an IPA, including version and OTA project/runtime/channel;
 * always remove temporary extracted files.
 */
export function verifyIosArtifact(file: string, release: NativeRelease, profile: Profile) {
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
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
