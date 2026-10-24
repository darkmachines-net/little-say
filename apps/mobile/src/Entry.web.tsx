/**
 * @file Selects the public homepage or browser app. Keep website copy/styles reachable only from this
 * web entry: native Entry.tsx must import only App. The homepage must not initialize the device library
 * or call app APIs. New PWA installs start at /app; older standalone root launches still enter App.
 */

import { lazy, Suspense } from 'react';
import LandingPage from './website/LandingPage.web';

const App = lazy(() => import('./App'));

/** Open /app directly and preserve older home-screen installs that still launch at the site root. */
export default function WebEntry() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const appPath = /^\/app(?:\/|$)/.test(window.location.pathname);
  const legacyInstall = standalone && ['/', '/index.html'].includes(window.location.pathname);
  return appPath || legacyInstall
    ? <Suspense fallback={<div role="status">Opening Little Say…</div>}><App /></Suspense>
    : <LandingPage />;
}
