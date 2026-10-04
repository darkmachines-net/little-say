import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { assert, cleanCommit, fail, git, machineRoot, mobile, node, npm, parseArgs, readJson, root, run, safeEnvironment, sha256, writeJson } from './common';
import { downloadAndroidCredentials, readExpoEnvironment, verifyExpoProject } from './eas-credentials';
import { releaseEnvironment, validateExpoEnvironment } from './environment';
import { verifyAndroidArtifacts } from './verify-android';
import { verifyIosArtifact } from './verify-ios';
import { type Baseline, type Platform, type Profile, profileConfig, releaseConfig, validateBaseline, verifyArtifacts, verifyOta } from './native-contract';
import { checkVersions } from './version';

const cli = resolve(root, 'tools/eas-cli/node_modules/eas-cli/bin/run');
const expo = resolve(root, 'node_modules/expo/bin/cli');
const configFile = resolve(machineRoot, 'native.json');
interface Machine { credentials?: string; artifactRoot: string; baselines: Record<string, string>; }
function machine(): Machine { return existsSync(configFile) ? readJson(configFile) : { artifactRoot: resolve(machineRoot, 'builds'), baselines: {} }; }
function saveMachine(config: Machine) { writeJson(configFile, config); }
function eas(args: string[], options: Parameters<typeof node>[2] = {}) {
  assert(existsSync(cli), 'Run npm run native:setup to install the locked EAS CLI.');
  assert(readJson(resolve(root, 'tools/eas-cli/node_modules/eas-cli/package.json')).version === '22.4.0', 'Wrong EAS CLI version. Run native:setup.');
  return node(cli, args, { cwd: mobile, env: safeEnvironment(), ...options });
}
async function remoteEnvironment(profile: Profile) {
  eas(['--version'], { capture: true });
  const release = releaseConfig();
  await verifyExpoProject(release);
  return validateExpoEnvironment(profile, await readExpoEnvironment(release, profileConfig(profile).environment));
}
function fingerprint(platform: Platform, env: NodeJS.ProcessEnv) {
  assert(!git(['ls-files', 'apps/mobile/android', 'apps/mobile/ios']), 'Release tooling expects generated, untracked native directories.');
  const raw = run(process.execPath, ['--import', 'tsx', resolve(root, 'scripts/release/fingerprint.ts'), platform], { env, capture: true });
  return JSON.parse(raw).hash as string;
}
function baselineFor(platform: Platform, profile: Profile, explicit?: string) {
  const file = explicit ? resolve(explicit) : machine().baselines[`${platform}:${profile}`];
  assert(file && existsSync(file), 'No retained native build. Run native:build or pass --baseline <baseline.json>.');
  const baseline = readJson<Baseline>(file); validateBaseline(baseline); verifyArtifacts(baseline, dirname(file));
  assert(baseline.platform === platform && baseline.profile === profile, 'The selected baseline has a different platform/profile.');
  return { file, baseline, directory: dirname(file) };
}
function requireSameSource(commit: string) { assert(cleanCommit() === commit, 'Source changed during release work. Start again from a clean committed checkout.'); }

async function main() {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3), ['platform', 'profile', 'baseline', 'message', 'dry-run', 'check', 'owner', 'project-id', 'server-url', 'credentials', 'device', 'help']);
  if (args.help || !command) {
    console.log('native:setup [--check]\nnative:configure --owner NAME --project-id UUID --server-url https://HOST [--credentials /external/credentials.json]\nnative:build --platform android|ios --profile internal|production\nnative:install --platform android --profile internal|production [--device SERIAL] [--baseline PATH]\nnative:submit --platform android|ios --profile production [--baseline PATH] [--dry-run]\nota:publish --platform android|ios --profile internal|production --message TEXT [--baseline PATH] [--dry-run]'); return;
  }
  const platform = (args.platform || 'android') as Platform;
  const profile = (args.profile || 'internal') as Profile;
  assert(['android', 'ios'].includes(platform) && ['internal', 'production'].includes(profile), 'Choose android/ios and internal/production.');
  if (command === 'setup') {
    if (!args.check) npm(['ci', '--prefix', 'tools/eas-cli'], { env: safeEnvironment() });
    eas(['--version']);
    console.log(`Machine config: ${configFile}\nRetained artifacts: ${machine().artifactRoot}`);
    if (platform === 'android') { run('java', ['-version']); assert(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT, 'Install Android Studio SDK and set ANDROID_HOME (see release guide).'); }
    else { assert(process.platform === 'darwin', 'Local iOS builds require macOS with Xcode.'); run('xcodebuild', ['-version']); run('pod', ['--version']); }
    return;
  }
  if (command === 'configure') {
    const current = readJson(resolve(root, 'native-release.json'));
    if (args.owner) current.expoOwner = args.owner;
    if (args['project-id']) current.expoProjectId = args['project-id'];
    if (args['server-url']) current.serverUrl = args['server-url'].replace(/\/+$/, '');
    writeJson(resolve(root, 'native-release.json'), current);
    const release = releaseConfig();
    try { eas(['whoami'], { capture: true }); } catch { eas(['login']); }
    await verifyExpoProject(release);
    const config = machine();
    if (args.credentials) {
      const file = resolve(args.credentials);
      assert(isAbsolute(args.credentials) && !file.toLowerCase().startsWith(`${root.toLowerCase()}\\`) && !file.startsWith(`${root}/`), 'Signing credentials must live outside the repository.');
      assert(readJson(file).android?.keystore?.keystorePath, 'Expected an EAS credentials.json with an absolute keystore path.'); config.credentials = file;
    } else if (platform === 'android') config.credentials = await downloadAndroidCredentials(release, resolve(machineRoot, 'signing', release.expoProjectId, randomUUID()));
    saveMachine(config);
    console.log('Configured. Review and commit native-release.json. Signing material stays outside the checkout.'); return;
  }
  checkVersions();
  const commit = cleanCommit();
  const release = releaseConfig();
  profileConfig(profile);
  if (command === 'build') {
    assert(!args['dry-run'], 'Use native:setup --check to inspect prerequisites.');
    assert(platform !== 'ios' || process.platform === 'darwin', 'Local iOS builds require a Mac. This command never queues a cloud build.');
    const remote = await remoteEnvironment(profile);
    const hash = fingerprint(platform, remote.env);
    const config = machine();
    const previousFile = config.baselines[`${platform}:${profile}`];
    if (previousFile && existsSync(previousFile)) {
      const previous = readJson<Baseline>(previousFile);
      assert(previous.release.version !== release.version || previous.fingerprint === hash, 'Native inputs changed without a new runtime version. Run release:prepare native, review and commit, then rebuild.');
    }
    const directory = resolve(config.artifactRoot, `${platform}-${profile}-${release.version}-${commit.slice(0, 12)}-${Date.now()}`);
    mkdirSync(directory, { recursive: true });
    const files: string[] = [];
    if (platform === 'android') {
      assert(config.credentials && existsSync(config.credentials), 'Run native:configure to download EAS-managed Android signing credentials.');
      const key = readJson(config.credentials).android?.keystore;
      assert(key && isAbsolute(key.keystorePath) && existsSync(key.keystorePath) && key.keyAlias && key.keyPassword && key.keystorePassword, 'Invalid external signing configuration.');
      // Generate native files without injecting signing secrets or backend API keys.
      node(expo, ['prebuild', '--clean', '--no-install', '--platform', 'android'], { cwd: mobile, env: remote.env });
      requireSameSource(commit);
      const temp = mkdtempSync(resolve(tmpdir(), 'little-say-gradle-'));
      try {
        const init = resolve(temp, 'signing.gradle');
        writeFileSync(init, `allprojects { p ->\n  p.afterEvaluate {\n    if (p.path == ':app' && p.plugins.hasPlugin('com.android.application')) {\n      def android = p.extensions.getByName('android')\n      def signing = android.signingConfigs.maybeCreate('littleSayRelease')\n      signing.storeFile = new File(System.getenv('LS_KEYSTORE'))\n      signing.storePassword = System.getenv('LS_STORE_PASSWORD')\n      signing.keyAlias = System.getenv('LS_KEY_ALIAS')\n      signing.keyPassword = System.getenv('LS_KEY_PASSWORD')\n      android.buildTypes.getByName('release').signingConfig = signing\n    }\n  }\n}\n`);
        const env = { ...remote.env, LS_KEYSTORE: key.keystorePath, LS_STORE_PASSWORD: key.keystorePassword, LS_KEY_ALIAS: key.keyAlias, LS_KEY_PASSWORD: key.keyPassword };
        // Run the wrapper main class directly, avoiding cmd.exe argument interpolation on Windows.
        const java = process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
        run(java, ['-classpath', resolve(mobile, 'android/gradle/wrapper/gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain', '--no-daemon', '--init-script', init, ':app:assembleRelease', ':app:bundleRelease'], { cwd: resolve(mobile, 'android'), env });
      } finally { rmSync(temp, { recursive: true, force: true }); }
      for (const [from, to] of [['apk/release/app-release.apk', 'app.apk'], ['bundle/release/app-release.aab', 'app.aab']]) {
        copyFileSync(resolve(mobile, 'android/app/build/outputs', from), resolve(directory, to)); files.push(to);
      }
      verifyAndroidArtifacts(directory, key, release);
    } else {
      eas(['build', '--local', '--platform', 'ios', '--profile', profile, '--output', resolve(directory, 'app.ipa'), '--non-interactive'], { env: remote.env });
      verifyIosArtifact(resolve(directory, 'app.ipa'), release, profile); files.push('app.ipa');
    }
    requireSameSource(commit);
    assert(hash === fingerprint(platform, remote.env), 'Native fingerprint changed during the build. No baseline was recorded.');
    assert(remote.hash === (await remoteEnvironment(profile)).hash, 'EAS environment changed during the build. No baseline was recorded.');
    const baseline: Baseline = { schema: 1, commit, platform, profile, channel: profile, environment: profileConfig(profile).environment, release, fingerprint: hash, environmentHash: remote.hash, artifacts: files.map(file => ({ file, sha256: sha256(resolve(directory, file)) })), createdAt: new Date().toISOString() };
    const file = resolve(directory, 'baseline.json'); writeJson(file, baseline);
    config.baselines[`${platform}:${profile}`] = file; saveMachine(config);
    console.log(`Built locally and retained: ${directory}\nBaseline: ${file}`); return;
  }
  const retained = baselineFor(platform, profile, args.baseline);
  if (command === 'install' || command === 'submit') {
    assert(retained.baseline.commit === commit, 'Install/submit from the exact clean build commit, or check out that commit. Artifacts are never rebuilt implicitly.');
    assert(JSON.stringify(retained.baseline.release) === JSON.stringify(release), 'Retained artifact configuration differs.');
    if (command === 'install') {
      assert(platform === 'android', 'For iOS, install the retained internal IPA with Xcode Devices, or submit a production build to TestFlight.');
      if (args['dry-run']) { console.log(`Would install ${resolve(retained.directory, 'app.apk')} in place.`); return; }
      const device = args.device ? ['-s', args.device] : [];
      run('adb', [...device, 'install', '-r', resolve(retained.directory, 'app.apk')]);
      const installed = run('adb', [...device, 'shell', 'dumpsys', 'package', 'net.darkmachines.littlesay'], { capture: true });
      assert(new RegExp(`versionCode=${release.androidVersionCode}\\b`).test(installed), 'Installed version code did not match.');
      writeJson(resolve(retained.directory, 'install-receipt.json'), { commit, versionCode: release.androidVersionCode, device: args.device || 'default', installedAt: new Date().toISOString() });
      console.log('Installed in place. Device boards and downloaded audio are preserved.');
    } else {
      assert(profile === 'production', 'Only a production/store build can be submitted. Build production first; internal iOS signing is not valid for App Store Connect.');
      const file = resolve(retained.directory, platform === 'android' ? 'app.aab' : 'app.ipa');
      if (args['dry-run']) { console.log(`Would submit retained ${file} through EAS, production profile. No build will run.`); return; }
      await verifyExpoProject(release);
      eas(['submit', '--platform', platform, '--profile', 'production', '--path', file, '--wait'], { env: releaseEnvironment(profile) });
      writeJson(resolve(retained.directory, 'submission-receipt.json'), { commit, artifact: file, sha256: sha256(file), completedAt: new Date().toISOString() });
      console.log('EAS submission completed. Store processing, review and rollout are separate.');
    }
    return;
  }
  assert(command === 'ota', 'Unknown native command. Use --help.');
  assert(args.message && args.message !== 'true', 'Provide --message describing this OTA update.');
  const remote = await remoteEnvironment(profile);
  const hash = fingerprint(platform, remote.env);
  verifyOta(retained.baseline, { release, fingerprint: hash, environmentHash: remote.hash, platform, profile });
  // Export even for dry runs: catch bundling errors before asking EAS to publish.
  const exportDir = resolve(root, 'artifacts', 'ota', `${platform}-${profile}-${commit}`);
  node(expo, ['export', '--platform', platform, '--output-dir', exportDir], { cwd: mobile, env: remote.env });
  requireSameSource(commit);
  assert(remote.hash === (await remoteEnvironment(profile)).hash, 'EAS environment changed during export. Run the command again.');
  if (args['dry-run']) { console.log(`OTA dry run passed. ${platform}, ${profile}, runtime ${release.version}, source ${commit}.\nBaseline: ${retained.file}\nNo update was published.`); return; }
  const result = JSON.parse(eas(['update', '--channel', profile, '--environment', profileConfig(profile).environment, '--platform', platform, '--message', args.message, '--input-dir', exportDir, '--skip-bundler', '--non-interactive', '--json'], { env: remote.env, capture: true }));
  const updates = Array.isArray(result) ? result : [result];
  const group = updates[0]?.group;
  assert(typeof group === 'string', 'EAS did not return an update group. Check EAS dashboard before retrying.');
  const readback = JSON.parse(eas(['update:view', group, '--json'], { capture: true }));
  assert(Array.isArray(readback) && readback.some(update => update.group === group && update.platform === platform && update.runtimeVersion === release.version && update.gitCommitHash === commit), 'Published update readback differs. Check EAS dashboard before retrying.');
  writeJson(resolve(exportDir, 'publication-receipt.json'), { group, commit, platform, profile, runtimeVersion: release.version, baseline: retained.file, readback, publishedAt: new Date().toISOString() });
  console.log(`Published and read back OTA group ${group}. Devices download on launch and apply on a subsequent launch; device application has not been verified.`);
}
main().catch(fail);
