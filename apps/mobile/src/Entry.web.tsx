/** @file Selects the website homepage or browser app without importing website code into native builds. */

import { lazy, Suspense } from 'react';
import LandingPage from './website/LandingPage.web';

const App = lazy(() => import('./App'));

/** Open /app directly and preserve older home-screen installs that still launch at the site root. */
export default function WebEntry() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const appPath = /^\/app\/?$/.test(window.location.pathname);
  const legacyInstall = standalone && ['/', '/index.html'].includes(window.location.pathname);
  return appPath || legacyInstall
    ? <Suspense fallback={<div role="status">Opening Little Say…</div>}><App /></Suspense>
    : <LandingPage />;
}
