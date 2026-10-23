/** @file Checks developer toolchains, stores external signing configuration, and installs an explicitly retained Little Say APK in place. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureLocalCredentials, resolveEasCli, setupToolchain, readConfig, saveLocalCredentialPaths, verifyLocalBuild } from '@mchartier/expo-release';
import { assert, mobile, root, run, writeJson } from './source-common';
import { machineFile, signingKey } from './local-native';

/** Reverify the canonical local build receipt, install its exact APK in place, and read back the installed version. */
export async function installLocalAndroid(receiptFile: string, deviceSerial?: string, execute = run) {
  const receipt = await verifyLocalBuild(resolve(receiptFile));
  const candidates = receipt.artifacts.filter(value => receipt.plan.components.some(component => component.id === value.target && component.platform === 'android'));
  assert(candidates.length === 1, 'Select one retained Android build.');
  const artifact = candidates[0]; const apk = artifact.receipt.manifest.files.find(file => file.path === 'app.apk');
  const component = receipt.plan.components.find(value => value.id === artifact.target)!;
  const versionCode = artifact.receipt.metadata.versionCode;
  assert(apk && component.applicationId === 'net.darkmachines.littlesay' && Number.isSafeInteger(versionCode) && Number(versionCode) > 0
    && versionCode === component.observation.versionCode, 'Retained APK application/version differs.');
  const device = deviceSerial ? ['-s', deviceSerial] : [];
  execute('adb', [...device, 'install', '-r', resolve(artifact.directory, apk.path)]);
  const installed = execute('adb', [...device, 'shell', 'dumpsys', 'package', component.applicationId], { capture: true });
  assert(new RegExp(`versionCode=${versionCode}\\b`).test(installed), 'Installed version differs.');
  writeJson(resolve(artifact.directory, '..', 'install-receipt.json'), { source: receipt.plan.source.commit, versionCode,
    device: deviceSerial || 'default', installedAt: new Date().toISOString() });
}

/** Reject unknown commands, misplaced flags and unsupported platforms before consulting providers or devices. */
export function parseNativeToolArguments(argv: string[]) {
  const [command, ...args] = argv;
  const permitted: Record<string, string[]> = { setup: ['login', 'platform'], configure: ['credentials'], install: ['receipt', 'device'] };
  assert(Object.hasOwn(permitted, command || ''), 'Choose setup, configure, or install.');
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index].replace(/^--/, '');
    assert(args[index].startsWith('--') && permitted[command].includes(key) && !options[key], 'Unknown, misplaced or repeated native tool option.');
    options[key] = key === 'login' ? 'true' : args[++index];
    assert(options[key] && !options[key].startsWith('--'), `Missing ${key}.`);
  }
  assert(!options.platform || ['android', 'ios'].includes(options.platform), 'Choose android or ios.');
  assert(command !== 'install' || options.receipt, 'Installation requires --receipt from a retained local build.');
  return { command, options };
}

async function main() {
  const { command, options } = parseNativeToolArguments(process.argv.slice(2));
  if (command === 'setup') {
    setupToolchain();
    if (options.login) execFileSync(process.execPath, [resolveEasCli(), 'login'], { cwd: mobile, stdio: 'inherit' });
    console.log(execFileSync(process.execPath, [resolveEasCli(), '--version'], { encoding: 'utf8' }));
    if (options.platform === 'ios') { assert(process.platform === 'darwin', 'Local iOS builds require macOS.'); run('xcodebuild', ['-version']); run('pod', ['--version']); }
    else { run('java', ['-version']); assert(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT, 'Set ANDROID_HOME to the Android SDK.'); }
    console.log(`Local signing configuration: ${machineFile}`); return;
  }
  if (command === 'configure') {
    if (options.credentials) {
      assert(isAbsolute(options.credentials) && existsSync(options.credentials), 'Use an existing absolute external credentials path.');
      signingKey(options.credentials);
      saveLocalCredentialPaths({ config: readConfig(), root, target: 'android', credentialsFile: options.credentials });
    } else await configureLocalCredentials({ config: readConfig(), root, target: 'android' });
    console.log('External Android signing configured.'); return;
  }
  assert(command === 'install' && options.receipt, 'Use native:install --receipt .release/artifacts-<digest>.json [--device SERIAL].');
  await installLocalAndroid(options.receipt, options.device);
  console.log('Installed in place; existing boards and audio are preserved.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Native tooling failed.'); process.exitCode = 1; });
}
