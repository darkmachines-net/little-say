/**
 * @file Prints an Expo native fingerprint for one platform, excluding generated native directories and
 * including release metadata.
 */

import { createFingerprintAsync } from '@expo/fingerprint';
import { mobile, readJson, root } from './common';
import { resolve } from 'node:path';

const platform = process.argv[2];
if (platform !== 'ios' && platform !== 'android') throw new Error('Fingerprint requires one native platform.');
// This app uses continuous native generation. Generated directories are never source inputs.
// Expo still hashes native modules, autolinking inputs, config plugins, assets and resolved config.
const fingerprint = await createFingerprintAsync(mobile, {
  platforms: [platform], silent: true,
  ignorePaths: ['android', 'android/**', 'ios', 'ios/**'],
  extraSources: [{ type: 'contents', id: 'native-release', contents: JSON.stringify(readJson(resolve(root, 'native-release.json'))), reasons: ['native release contract'] }],
});
console.log(JSON.stringify(fingerprint));
