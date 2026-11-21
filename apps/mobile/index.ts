/** @file Uses the toolkit's compatibility gate before loading the platform-resolved application entry. */

import { registerRootComponent } from '@darkmachines-net/expo-release/register';

// A static import would evaluate native dependencies before the compatibility check can run.
// eslint-disable-next-line @typescript-eslint/no-require-imports
registerRootComponent(() => require('./src/Entry').default);
