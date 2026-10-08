/** @file Defines platform-specific native compatibility inputs shared by EAS and local builds/OTA. */

const { resolveRelease } = require('./release-metadata.cjs');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const release = resolveRelease(require('../../native-release.json'));
const platform = process.env.LITTLE_SAY_FINGERPRINT_PLATFORM || process.env.EAS_BUILD_PLATFORM;
const profile = process.env.LITTLE_SAY_CHANNEL || 'internal';
const eas = require('./eas.json');
const build = { ...eas.build[profile] };
if (platform === 'android') { delete release.iosBuildNumber; delete build.ios; }
if (platform === 'ios') { delete release.androidVersionCode; delete build.android; }

module.exports = {
  // Replaced with resolved content below; raw metadata would defeat target-version overlays.
  ignorePaths: ['android', 'android/**', 'ios', 'ios/**', '../../native-release.json', 'eas.json', 'assets/brand/colors.json'],
  extraSources: [
    { type: 'file', filePath: 'fingerprint.config.js', reasons: ['fingerprint policy'] },
    ...['../../.gitignore', '../../.easignore', '../../.npmrc', '.easignore'].filter(path => existsSync(resolve(__dirname, path))).map(path => ({ type: 'contents', id: `archive:${path}`, contents: readFileSync(resolve(__dirname, path), 'utf8').replace(/\r\n/g, '\n'), reasons: ['cloud archive/install configuration'] })),
    { type: 'contents', id: 'brand-colors', contents: JSON.stringify(require('./assets/brand/colors.json')), reasons: ['native brand configuration'] },
    { type: 'contents', id: 'native-release', contents: JSON.stringify(release), reasons: ['native release contract'] },
    { type: 'contents', id: 'native-build-profile', contents: JSON.stringify({ profile, build, cli: eas.cli }), reasons: ['selected native build configuration'] },
  ],
  /** Omit only other-platform config and non-native scripts; preserve all selected native values. */
  fileHookTransform(source, chunk) {
    if (source.type !== 'contents' || !chunk) return chunk;
    if (source.id === 'expoConfig') {
      const config = JSON.parse(String(chunk));
      delete config.web;
      if (platform === 'android') delete config.ios;
      if (platform === 'ios') delete config.android;
      return JSON.stringify(config);
    }
    if (source.id === 'packageJson:scripts') {
      const scripts = JSON.parse(String(chunk));
      return JSON.stringify(Object.fromEntries(Object.entries(scripts).filter(([key]) => /^(preinstall|install|postinstall|prepare|prepublish|eas-build-.*|android|ios)$/.test(key))));
    }
    return chunk;
  },
};
