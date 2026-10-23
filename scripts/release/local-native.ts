/** @file Prepares and compiles Little Say's local Android build and verifies local APK/AAB/IPA identity; shared tooling owns EAS invocation, signing admission and receipts. */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { assert, git, mobile, node, readJson, root, run, sha256, sourceEnvironment } from './source-common';
import { verifyAndroidArtifacts } from './verify-android';
import { verifyIosArtifact } from './verify-ios';
import type { HookRequest } from './hooks';

export interface NativeRelease { version: string; androidVersionCode: number; iosBuildNumber: string; expoOwner: string; expoProjectId: string; serverUrl: string; }
export type Profile = 'internal' | 'production';
export const machineRoot = resolve(process.env.LOCALAPPDATA || process.env.XDG_CONFIG_HOME || resolve(homedir(), '.config'), 'little-say');
export const machineFile = resolve(machineRoot, 'expo-release.json');
/** Require credentials outside the checkout and generated artifact directory, with an existing absolute keystore path. */
export function signingKey(file = (() => { const settings = readJson(machineFile); return settings.targets?.android?.credentialsFile; })()) {
  const outside = (path: string) => { const rel = relative(root, path); return isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../'); };
  assert(typeof file === 'string' && isAbsolute(file) && outside(file), 'Configure external signing credentials with native:configure.');
  const key = readJson(file).android?.keystore;
  assert(key && isAbsolute(key.keystorePath) && outside(key.keystorePath) && existsSync(key.keystorePath)
    && key.keyAlias && key.keyPassword && key.keystorePassword, 'Invalid external Android signing configuration.');
  return key;
}

/** Build one explicit local target or verify its retained artifact without creating provider work. */
export async function localNativeHook(request: HookRequest, environment: NodeJS.ProcessEnv) {
  const target = request.target;
  const release = readJson<NativeRelease>(resolve(root, 'native-release.json'));
  const source = request.source?.commit || request.plan?.source?.commit;
  assert(source && source === git(['rev-parse', 'HEAD']), 'Use the exact committed build source.');
  const verify = (artifact: any) => {
    assert(artifact?.kind === 'native' && artifact.nativeOrigin === 'local' && artifact.source === source && artifact.platform === target.platform
      && artifact.profile === request.profile && artifact.version === release.version && artifact.runtime === release.version
      && Number(artifact.versionCode) === Number(target.platform === 'android' ? release.androidVersionCode : release.iosBuildNumber), 'Local artifact identity differs.');
    assert(Array.isArray(artifact.files) && artifact.files.length > 0, 'Missing local native artifacts.');
    for (const file of artifact.files) {
      assert(['app.apk', 'app.aab', 'app.ipa'].includes(file.path) && sha256(resolve(artifact.directory, file.path)) === file.sha256, 'Local artifact bytes changed.');
    }
    if (target.platform === 'ios') { assert(process.platform === 'darwin', 'IPA verification requires macOS.'); verifyIosArtifact(resolve(artifact.directory, 'app.ipa'), release, request.profile); }
    return { schemaVersion: 1, verified: true, artifact };
  };
  if (request.action === 'verify') return verify(request.artifact);
  assert(request.action === 'build' && target.platform === 'android' && ['prepare', 'compile'].includes(request.phase || '')
    && request.plan?.origin?.kind === 'local', 'Local Android builds require an explicit shared local-build request.');
  const { nativeFingerprint } = await import('./hooks');
  const publicEnvironment = sourceEnvironment(environment);
  const fingerprint = nativeFingerprint(target.platform, publicEnvironment);
  if (request.phase === 'prepare') {
    node(resolve(root, 'node_modules/expo/bin/cli'), ['prebuild', '--clean', '--no-install', '--platform', 'android'], { cwd: mobile, env: publicEnvironment });
    assert(nativeFingerprint(target.platform, publicEnvironment) === fingerprint, 'Native generation changed the inspected build fingerprint.');
    return { schemaVersion: 1, prepared: true };
  }
  assert(request.outputDirectory, 'The shared runner must provide an artifact directory.');
  const directory = resolve(request.outputDirectory); mkdirSync(directory, { recursive: true });
  const files: string[] = [];
  if (target.platform === 'android') {
    const key = { keystorePath: environment.LS_KEYSTORE!, keystorePassword: environment.LS_STORE_PASSWORD!, keyAlias: environment.LS_KEY_ALIAS!, keyPassword: environment.LS_KEY_PASSWORD! };
    assert(Object.values(key).every(value => typeof value === 'string' && value.length > 0) && isAbsolute(key.keystorePath), 'Shared local signing inputs are missing.');
    const temporary = mkdtempSync(resolve(tmpdir(), 'little-say-gradle-'));
    try {
      const init = resolve(temporary, 'signing.gradle');
      writeFileSync(init, `// Configure Little Say's generated release variant from external signing material.\nallprojects { p ->\n  p.afterEvaluate {\n    if (p.path == ':app' && p.plugins.hasPlugin('com.android.application')) {\n      def android = p.extensions.getByName('android')\n      def signing = android.signingConfigs.maybeCreate('littleSayRelease')\n      signing.storeFile = new File(System.getenv('LS_KEYSTORE'))\n      signing.storePassword = System.getenv('LS_STORE_PASSWORD')\n      signing.keyAlias = System.getenv('LS_KEY_ALIAS')\n      signing.keyPassword = System.getenv('LS_KEY_PASSWORD')\n      android.buildTypes.getByName('release').signingConfig = signing\n    }\n  }\n}\n`);
      const java = process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
      run(java, ['-classpath', resolve(mobile, 'android/gradle/wrapper/gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain', '--no-daemon', '--init-script', init, ':app:assembleRelease', ':app:bundleRelease'],
        { cwd: resolve(mobile, 'android'), env: { ...publicEnvironment, LS_KEYSTORE: key.keystorePath, LS_STORE_PASSWORD: key.keystorePassword, LS_KEY_ALIAS: key.keyAlias, LS_KEY_PASSWORD: key.keyPassword } });
    } finally { rmSync(temporary, { recursive: true, force: true }); }
    for (const [from, to] of [['apk/release/app-release.apk', 'app.apk'], ['bundle/release/app-release.aab', 'app.aab']]) {
      copyFileSync(resolve(mobile, 'android/app/build/outputs', from), resolve(directory, to)); files.push(to);
    }
    verifyAndroidArtifacts(directory, key, release);
  }
  assert(source === git(['rev-parse', 'HEAD']) && !git(['status', '--porcelain', '--untracked-files=no']), 'Tracked source changed during the local build.');
  assert(nativeFingerprint(target.platform, publicEnvironment) === fingerprint, 'Native compilation changed the inspected build fingerprint.');
  return verify({ kind: 'native', nativeOrigin: 'local', target: target.id, platform: target.platform, profile: request.profile, source, directory,
    fingerprint, runtime: release.version, version: release.version, versionCode: Number(target.platform === 'android' ? release.androidVersionCode : release.iosBuildNumber),
    native: { ...release, applicationId: 'net.darkmachines.littlesay', versionCode: Number(target.platform === 'android' ? release.androidVersionCode : release.iosBuildNumber) },
    metadata: release, files: files.map(path => ({ path, sha256: sha256(resolve(directory, path)) })) });
}
