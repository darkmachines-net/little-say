/** @file Reads the loaded web release for About while excluding native binary and OTA metadata. */

import Constants from 'expo-constants';
import type { AppInfo } from './appInfo';

/** Identify the loaded web bundle, including an offline cached release, without querying the server. */
export function getAppInfo(): AppInfo {
  return {
    version: Constants.expoConfig?.extra?.releaseVersion ?? Constants.expoConfig?.version ?? 'Unavailable',
    environment: __DEV__ ? 'Web development' : 'Web',
  };
}
