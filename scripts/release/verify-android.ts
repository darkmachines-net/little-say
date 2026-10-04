/**
 * @file Checks locally built Android artifacts against the signing credential and native release
 * identity.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { assert, run, safeEnvironment } from './common';
import type { NativeRelease } from './native-contract';

/**
 * Use installed Java and Android SDK tools to verify APK/AAB signatures and the APK package/version,
 * cleaning temporary certificate files on exit.
 */
export function verifyAndroidArtifacts(directory: string, key: { keystorePath: string; keystorePassword: string; keyAlias: string }, release: NativeRelease) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  assert(sdk, 'Set ANDROID_HOME to the Android SDK.');
  const buildTools = resolve(sdk, 'build-tools');
  const versions = readdirSync(buildTools).filter(name => /^\d+\.\d+\.\d+$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const tools = versions.map(version => resolve(buildTools, version)).find(path => existsSync(resolve(path, 'lib/apksigner.jar')));
  assert(tools, 'Install Android SDK Build Tools using Android Studio.');
  const javaTool = (tool: string) => process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin', `${tool}${process.platform === 'win32' ? '.exe' : ''}`) : tool;
  const temp = mkdtempSync(resolve(tmpdir(), 'little-say-cert-'));
  try {
    const cert = resolve(temp, 'signer.der');
    run(javaTool('keytool'), ['-exportcert', '-keystore', key.keystorePath, '-alias', key.keyAlias, '-storepass:env', 'LS_STORE_PASSWORD', '-file', cert], { capture: true, env: { ...safeEnvironment(), LS_STORE_PASSWORD: key.keystorePassword } });
    const expected = createHash('sha256').update(readFileSync(cert)).digest('hex');
    const apk = run(javaTool('java'), ['-jar', resolve(tools, 'lib/apksigner.jar'), 'verify', '--print-certs', resolve(directory, 'app.apk')], { capture: true });
    assert(apk.toLowerCase().includes(`certificate sha-256 digest: ${expected}`), 'APK signer differs from the configured EAS keystore.');
    const aab = run(javaTool('keytool'), ['-printcert', '-jarfile', resolve(directory, 'app.aab')], { capture: true });
    assert(aab.replaceAll(':', '').toLowerCase().includes(expected), 'AAB signer differs from the configured EAS keystore.');
    assert(/jar verified/i.test(run(javaTool('jarsigner'), ['-verify', resolve(directory, 'app.aab')], { capture: true })), 'AAB signature verification failed.');
    const badging = run(resolve(tools, process.platform === 'win32' ? 'aapt.exe' : 'aapt'), ['dump', 'badging', resolve(directory, 'app.apk')], { capture: true });
    assert(badging.includes("name='net.darkmachines.littlesay'") && badging.includes(`versionCode='${release.androidVersionCode}'`) && badging.includes(`versionName='${release.version}'`), 'APK identity/version differs from the release contract.');
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
