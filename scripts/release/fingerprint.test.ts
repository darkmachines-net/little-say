/** @file Checks the real Expo fingerprint policy across version overlays, platform-only config changes, and local/cloud adapters. */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mobile, node, root } from './common';
import { nativeFingerprint, nativeRuntime, versionEnvironment } from './expo';
import { releaseEnvironment } from './environment';

const require = createRequire(import.meta.url);
const metadata = require(resolve(mobile, 'release-metadata.cjs'));
describe('shared fingerprint policy', () => {
  it('resolves the same fingerprint runtime Expo will embed for a selected platform', () => {
    const env = releaseEnvironment('internal');
    expect(nativeRuntime('android', env)).toBe(nativeFingerprint('android', env));
  }, 45000);
  it('permits only complete version overlays and never mutates cached native metadata', () => {
    const original = { version: '1.0.0', androidVersionCode: 2, iosBuildNumber: '3', expoProjectId: 'project' };
    const copy = metadata.resolveRelease(original, ''); delete copy.iosBuildNumber;
    expect(original.iosBuildNumber).toBe('3');
    expect(() => metadata.resolveRelease(original, JSON.stringify({ version: '1.0.1', androidVersionCode: 3, iosBuildNumber: '4', expoProjectId: 'other' }))).toThrow('Invalid');
    expect(metadata.resolveRelease(original, JSON.stringify({ version: '1.0.1', androidVersionCode: 3, iosBuildNumber: '4' })).expoProjectId).toBe('project');
  });
  it('normalizes allocated versions while full fingerprints retain runtime differences', () => {
    const env = releaseEnvironment('internal');
    const other = versionEnvironment(env, { version: '9.8.7', androidVersionCode: 765, iosBuildNumber: '876' });
    expect(nativeFingerprint('android', env, true)).toBe(nativeFingerprint('android', other, true));
    expect(nativeFingerprint('android', env)).not.toBe(nativeFingerprint('android', other));
    const resolved = JSON.parse(node(resolve(root, 'node_modules/tsx/dist/cli.mjs'), [resolve(root, 'scripts/release/fingerprint.ts'), 'android'], { env: other, capture: true }));
    expect(resolved.sources.some((s: any) => s.filePath === '../../native-release.json')).toBe(false);
    expect(JSON.parse(resolved.sources.find((s: any) => s.id === 'native-release').contents)).toMatchObject({ version: '9.8.7', androidVersionCode: 765 });
  }, 45000);
  it('isolates selected platform config while preserving permissions and native build hooks', () => {
    const file = resolve(mobile, 'fingerprint.config.js');
    const source = `process.env.LITTLE_SAY_FINGERPRINT_PLATFORM='android'; const config=require(${JSON.stringify(file)}); const transform=(id,value)=>config.fileHookTransform({type:'contents',id},JSON.stringify(value)); console.log(JSON.stringify({a:transform('expoConfig',{version:'1',android:{permissions:['CAMERA']},ios:{supportsTablet:true},web:{name:'web'}}),b:transform('expoConfig',{version:'1',android:{permissions:['CAMERA']},ios:{supportsTablet:false},web:{name:'other'}}),c:transform('expoConfig',{version:'1',android:{permissions:['AUDIO']}}),scripts:transform('packageJson:scripts',{test:'test',typecheck:'tsc','build:web':'expo export','eas-build-post-install':'prepare-native'})}));`;
    const result = JSON.parse(node(resolve(root, 'node_modules/tsx/dist/cli.mjs'), ['-e', source], { capture: true, env: releaseEnvironment('internal') }));
    expect(result.a).toBe(result.b); expect(result.a).not.toBe(result.c); expect(JSON.parse(result.scripts)).toEqual({ 'eas-build-post-install': 'prepare-native' });
  });
});
