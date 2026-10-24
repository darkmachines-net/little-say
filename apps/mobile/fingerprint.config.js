/** @file Expo native compatibility excludes allocated versions and keeps native environment and profile inputs. */
const { fingerprintTransform } = require('@mchartier/expo-release/expo');
const release = { ...require('../../native-release.json') };
for (const key of ['version', 'androidVersionCode', 'iosBuildNumber']) delete release[key];
const profile = process.env.LITTLE_SAY_CHANNEL || 'internal';
const eas = require('./eas.json');
module.exports = {
  // Keep strict native source/configuration hashing; generated versions are excluded below.
  preset: 'strict',
  sourceSkips: ['ExpoConfigVersions', 'ExpoConfigRuntimeVersionIfString'],
  ignorePaths: ['android', 'android/**', 'ios', 'ios/**', '../../native-release.json', 'eas.json'],
  extraSources: [
    { type: 'file', filePath: 'fingerprint.config.js', reasons: ['Fingerprint policy'] },
    { type: 'contents', id: 'native-release', contents: JSON.stringify(release), reasons: ['Native project and server identity'] },
    { type: 'contents', id: 'native-profile', contents: JSON.stringify({ profile, build: eas.build[profile], cli: eas.cli }), reasons: ['Native build configuration'] }
  ],
  fileHookTransform: fingerprintTransform
};
