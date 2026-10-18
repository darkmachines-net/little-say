/** @file Verifies native-tool command boundaries and receipt-backed in-place installation, including APK integrity before adb. */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createArtifactReceipt, finalizePlan, planRelease, readConfig, saveLocalCredentialPaths, verifyLocalBuild, writeLocalReceipt } from '@mchartier/expo-release';
import { installLocalAndroid, parseNativeToolArguments } from './native-tools';

const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); rmSync(directory, { recursive: true, force: true }); } });

it('rejects wrong-platform configuration and misplaced or incomplete device options before execution', () => {
  expect(parseNativeToolArguments(['setup', '--platform', 'ios', '--login'])).toEqual({ command: 'setup', options: { platform: 'ios', login: 'true' } });
  expect(parseNativeToolArguments(['configure', '--credentials', 'external.json']).options.credentials).toBe('external.json');
  expect(parseNativeToolArguments(['install', '--receipt', 'receipt.json', '--device', 'serial']).options.device).toBe('serial');
  for (const args of [[], ['unknown'], ['setup', '--platform', 'ipados'], ['configure', '--platform', 'ios'],
    ['configure', '--login'], ['install'], ['install', '--receipt', '--device'], ['install', '--receipt', 'a', '--receipt', 'b']]) {
    expect(() => parseNativeToolArguments(args)).toThrow();
  }
});

it('preserves original Little Say artifact and baseline metadata when refreshing a credential path', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'little-say-credentials-')); temporary.push(fixture);
  const checkout = join(fixture, 'checkout'); const settingsRoot = join(fixture, 'settings');
  mkdirSync(checkout); mkdirSync(join(settingsRoot, 'little-say'), { recursive: true });
  const credentialsFile = join(settingsRoot, 'credentials.json'); writeFileSync(credentialsFile, '{}');
  const legacy = { credentials: credentialsFile, artifactRoot: join(settingsRoot, 'builds'),
    baselines: { 'android:internal': join(settingsRoot, 'builds', 'baseline.json') } };
  writeFileSync(join(settingsRoot, 'little-say', 'native.json'), JSON.stringify(legacy));
  const saved = saveLocalCredentialPaths({ config: readConfig(), root: checkout, target: 'android', credentialsFile,
    platform: 'win32', environment: { LOCALAPPDATA: settingsRoot } });
  expect(saved.settings.legacy).toEqual(legacy);
  expect(saved.credentials.credentialsFile).toBe(credentialsFile);
});

it('installs exact shared APK evidence and keeps installation readback outside its immutable file inventory', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'little-say-install-')); temporary.push(directory);
  const config = { schemaVersion: 1 as const, repository: 'MChartier/little-say', defaultBranch: 'master', components: [{
    id: 'android', kind: 'native' as const, platform: 'android' as const, builder: 'eas' as const,
    localBuilder: 'command' as const, applicationId: 'net.darkmachines.littlesay' }] };
  const source = { repository: config.repository, commit: 'a'.repeat(40), toolkitCommit: 'b'.repeat(40), origin: 'local' as const };
  const observations = [{ id: 'android', identity: 'android-inputs', version: '1.2.3', versionCode: 4, runtime: '1.2.3' }];
  const plan = finalizePlan(planRelease({ config, source, observations, origin: { kind: 'local' }, operation: 'build' }), source, observations);
  const files = join(directory, 'android', 'files'); mkdirSync(files, { recursive: true });
  const apk = join(files, 'app.apk'); writeFileSync(apk, 'inert signed APK fixture');
  const receipt = await createArtifactReceipt({ plan, target: 'android', directory: files, metadata: { kind: 'native', versionCode: 4 } });
  const saved = writeLocalReceipt(directory, plan, [{ target: 'android', directory: files, receipt }]);
  const execute = vi.fn((_command: string, args: string[]) => args.includes('dumpsys') ? 'versionCode=4 minSdk=24' : 'Success');
  await installLocalAndroid(saved.file, 'fixture-device', execute);
  expect(execute.mock.calls[0]).toEqual(['adb', ['-s', 'fixture-device', 'install', '-r', apk]]);
  expect(execute.mock.calls[1][1]).toEqual(['-s', 'fixture-device', 'shell', 'dumpsys', 'package', 'net.darkmachines.littlesay']);
  expect(existsSync(join(files, '..', 'install-receipt.json'))).toBe(true);
  await expect(verifyLocalBuild(saved.file)).resolves.toMatchObject({ planDigest: plan.digest });
  writeFileSync(apk, 'changed bytes'); execute.mockClear();
  await expect(installLocalAndroid(saved.file, 'fixture-device', execute)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
