/** @file Registers the shared app root with Expo for native and web entry points. */

import { registerRootComponent } from 'expo';
import App from './src/App';
registerRootComponent(App);
