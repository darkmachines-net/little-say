/** @file Reads the running release and installed native binary metadata for About, without network requests. */

import * as Application from 'expo-application';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Updates from 'expo-updates';

export interface AppInfo {
  version: string;
  environment: string;
  nativeVersion?: string;
  buildNumber?: string;
  channel?: string;
  runtimeVersion?: string;
  updateSource?: string;
  updateId?: string;
}

/** Read the active bundle version separately from the installed binary; never report Expo Go's host build as Little Say. */
export function getAppInfo(): AppInfo {
  const expoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  const updatesEnabled = !expoGo && !__DEV__ && Updates.isEnabled;
  return {
    version: Constants.expoConfig?.extra?.releaseVersion ?? Constants.expoConfig?.version ?? 'Unavailable',
    environment: expoGo ? 'Expo Go' : __DEV__ ? 'Development build' : 'Release build',
    ...(!expoGo ? {
      nativeVersion: Application.nativeApplicationVersion ?? 'Unavailable',
      buildNumber: Application.nativeBuildVersion ?? 'Unavailable',
    } : {}),
    ...(updatesEnabled ? {
      channel: Updates.channel ?? undefined,
      runtimeVersion: Updates.runtimeVersion ?? undefined,
      updateSource: Updates.isEmbeddedLaunch ? 'Included with app' : 'Downloaded update',
      updateId: Updates.updateId ?? undefined,
    } : {}),
  };
}
