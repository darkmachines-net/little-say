/** @file Verifies generated iOS pod configuration with and without optional Google OAuth setup. */

import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { getPrebuildConfigAsync } from '@expo/prebuild-config';
import { withDefaultBaseMods, evalModsAsync } from '@expo/config-plugins/build/plugins/mod-compiler';

const require = createRequire(import.meta.url);
const tar = require('tar');
const { resolveExtraBuildDependenciesAsync } = require('expo-modules-autolinking/build/platforms/apple/apple');
const appRoot = resolve('apps/mobile');
const temporary: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function generatePodConfiguration() {
  const dir = mkdtempSync(resolve(tmpdir(), 'little-say-ios-pods-'));
  temporary.push(dir);
  // Use the locked Expo SDK's real Podfile, not a hand-written approximation.
  tar.x({ file: resolve(require.resolve('expo/package.json'), '../template.tgz'), cwd: dir, sync: true }, ['package/ios/Podfile']);
  mkdirSync(resolve(dir, 'ios'));
  writeFileSync(resolve(dir, 'ios/Podfile'), readFileSync(resolve(dir, 'package/ios/Podfile')));
  const { exp } = await getPrebuildConfigAsync(appRoot, { platforms: ['ios'] });
  const config = withDefaultBaseMods(exp);
  // Evaluate the actual file-backed CocoaPods mods; Windows cannot run full iOS prebuild/pod install.
  config.mods = { ios: Object.fromEntries(Object.entries(config.mods!.ios!)
    .filter(([name]) => ['podfile', 'podfileProperties'].includes(name))) };
  await evalModsAsync(config, { projectRoot: dir, platforms: ['ios'] });
  return {
    podfile: readFileSync(resolve(dir, 'ios/Podfile'), 'utf8'),
    properties: JSON.parse(readFileSync(resolve(dir, 'ios/Podfile.properties.json'), 'utf8')),
    extraPods: await resolveExtraBuildDependenciesAsync(resolve(dir, 'ios')),
  };
}

it.each(['', 'com.googleusercontent.apps.synthetic-test'])('generates targeted AppCheck module maps with scheme %j', async scheme => {
  vi.stubEnv('LITTLE_SAY_GOOGLE_IOS_URL_SCHEME', scheme);
  const { podfile, properties, extraPods } = await generatePodConfiguration();
  if (scheme) {
    // The existing Nitro plugin owns this path; do not duplicate its declarations.
    for (const name of ['AppCheckCore', 'GoogleUtilities', 'RecaptchaInterop']) {
      expect(podfile.split(`pod '${name}', :modular_headers => true`)).toHaveLength(2);
    }
    expect(properties['apple.extraPods']).toBeUndefined();
  } else {
    expect(extraPods ?? []).toEqual([
      { name: 'GoogleUtilities', modular_headers: true },
      { name: 'RecaptchaInterop', modular_headers: true },
    ]);
    expect(podfile).toContain('use_expo_modules!');
    expect(podfile).not.toContain("pod 'AppCheckCore'");
  }
  expect(podfile).not.toMatch(/^\s*use_modular_headers!/m);
  expect(properties['ios.useFrameworks']).toBeUndefined();
});
