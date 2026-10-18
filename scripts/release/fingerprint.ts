/**
 * @file Prints an Expo native fingerprint for one platform, excluding generated native directories and
 * including release metadata.
 */

import { createFingerprintAsync } from '@expo/fingerprint';
import { mobile } from './source-common';

const platform = process.argv[2];
if (platform !== 'ios' && platform !== 'android') throw new Error('Fingerprint requires one native platform.');
// This app uses continuous native generation. Generated directories are never source inputs.
// Expo still hashes native modules, autolinking inputs, config plugins, assets and resolved config.
process.env.LITTLE_SAY_FINGERPRINT_PLATFORM = platform;
const fingerprint = await createFingerprintAsync(mobile, {
  platforms: [platform], silent: true,
});
console.log(JSON.stringify(fingerprint));
