/** @file Excludes native OTA controls from the web app, which uses the service-worker update banner. */

import type { AppUpdateSettingsProps } from './AppUpdateSettings';

/** Render no native update controls on web; browser updates retain their existing approval flow. */
export function AppUpdateSettings(_props: AppUpdateSettingsProps) { return null; }
