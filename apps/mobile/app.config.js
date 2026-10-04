const release = require('../../native-release.json');
const colors = require('./assets/brand/colors.json');

module.exports = ({ config }) => {
  const channel = process.env.LITTLE_SAY_CHANNEL || 'internal';
  if (!['internal', 'production'].includes(channel)) throw new Error('Unknown update channel.');
  const projectId = release.expoProjectId;
  return {
    ...config,
    version: release.version,
    icon: './assets/brand/app-icon.png',
    ...(release.expoOwner ? { owner: release.expoOwner } : {}),
    android: {
      ...config.android,
      versionCode: release.androidVersionCode,
      adaptiveIcon: { foregroundImage: './assets/brand/adaptive-foreground.png', backgroundColor: colors.background },
    },
    ios: { ...config.ios, buildNumber: release.iosBuildNumber },
    web: { ...config.web, themeColor: colors.background, backgroundColor: colors.background, favicon: './assets/brand/favicon.png' },
    plugins: [...(config.plugins || []), ['expo-splash-screen', { image: './assets/brand/splash.png', imageWidth: 180, resizeMode: 'contain', backgroundColor: colors.background }]],
    runtimeVersion: { policy: 'appVersion' },
    updates: projectId ? {
      url: `https://u.expo.dev/${projectId}`,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      requestHeaders: { 'expo-channel-name': channel },
    } : { enabled: false },
    extra: {
      ...config.extra,
      serverUrl: release.serverUrl || '',
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
};
