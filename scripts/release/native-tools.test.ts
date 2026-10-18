/** @file Verifies device installation consumes the canonical shared local receipt, rehashes APK bytes before adb, and preserves in-place upgrade behavior. */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createArtifactReceipt, finalizePlan, planRelease, verifyLocalBuild, writeLocalReceipt } from '@mchartier/expo-release';
import { installLocalAndroid } from './native-tools';

const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); rmSync(directory, { recursive: true, force: true }); } });

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
