/**
 * @file Resolves Expo branding, native versions, server origin, and OTA settings from the release
 * contract.
 */

const { runtimeVersion, developmentConfig } = require('@mchartier/expo-release/expo');
const release = require('../../native-release.json');
const colors = require('./assets/brand/colors.json');

/**
 * Merge the base Expo config with release metadata and the selected update channel; reject unknown
 * channels.
 */
module.exports = ({ config }) => {
  const channel = process.env.LITTLE_SAY_CHANNEL || 'beta';
  if (!['beta', 'production'].includes(channel)) throw new Error('Unknown update channel.');
  const projectId = release.expoProjectId;
  // The native Google SDK autolinks even without an OAuth scheme. In that case the Nitro
  // plugin is absent, so supply only the module maps required by its Swift AppCheck dependency.
  const googleIosPlugin = process.env.LITTLE_SAY_GOOGLE_IOS_URL_SCHEME
    ? ['react-native-nitro-google-signin', { iosUrlScheme: process.env.LITTLE_SAY_GOOGLE_IOS_URL_SCHEME }]
    : ['expo-build-properties', { ios: { extraPods: [
      { name: 'GoogleUtilities', modular_headers: true },
      { name: 'RecaptchaInterop', modular_headers: true },
    ] } }];
  return developmentConfig({
    ...config,
    version: release.version,
    icon: './assets/brand/app-icon.png',
    ...(release.expoOwner ? { owner: release.expoOwner } : {}),
    android: {
      ...config.android,
      versionCode: release.androidVersionCode,
      adaptiveIcon: { foregroundImage: './assets/brand/adaptive-foreground.png', backgroundColor: colors.background },
    },
    ios: { ...config.ios, buildNumber: release.iosBuildNumber, usesAppleSignIn: true, entitlements: { ...config.ios?.entitlements, 'com.apple.developer.applesignin': ['Default'] } },
    web: { ...config.web, themeColor: colors.background, backgroundColor: colors.background, favicon: './assets/brand/favicon.png' },
    plugins: [...(config.plugins || []), 'expo-secure-store', googleIosPlugin, ['expo-splash-screen', { image: './assets/brand/splash.png', imageWidth: 180, resizeMode: 'contain', backgroundColor: colors.background }]],
    runtimeVersion: runtimeVersion(release.version),
    updates: projectId ? {
      url: `https://u.expo.dev/${projectId}`,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      requestHeaders: { 'expo-channel-name': channel },
    } : { enabled: false },
    extra: {
      ...config.extra,
      releaseVersion: release.version,
      serverUrl: release.serverUrl || '',
      ...(projectId ? { eas: { projectId } } : {}),
    },
  });
};
