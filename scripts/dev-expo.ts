/** @file Prepares Expo Go or toolkit-owned native development launch settings for the selected local stack. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { developmentServer } from '@mchartier/expo-release/development';
import { expoEnvironment, type DevelopmentConfig } from './dev-config';
const require = createRequire(import.meta.url);

/** Preserve the toolkit's native identity while supplying only public stack URLs; Go uses the same API/proxy contract. */
export function developmentExpo(root: string, config: DevelopmentConfig, flags: Set<string>) {
  if (flags.has('--dev-client')) return developmentServer(root, {
    port: config.expoPort, host: config.host, clear: flags.has('--clear'), web: flags.has('--web'),
    publicEnvironment: { NODE_ENV: 'development', EXPO_PUBLIC_API_URL: config.apiUrl,
      EXPO_PUBLIC_WEB_API_URL: config.webUrl, LITTLE_SAY_DEV_PROXY_URL: config.apiUrl },
  });
  return { command: process.execPath, cwd: resolve(root, 'apps/mobile'), env: expoEnvironment(process.env, config),
    args: [require.resolve('expo/bin/cli'), 'start', '--go', '--lan', '--port', String(config.expoPort),
      ...(flags.has('--web') ? ['--web'] : []), ...(flags.has('--clear') ? ['--clear'] : [])] };
}
