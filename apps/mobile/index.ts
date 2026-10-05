/** @file Registers Expo's platform-resolved entry so website content stays out of native bundles. */

import { registerRootComponent } from 'expo';
import App from './src/Entry';
registerRootComponent(App);
