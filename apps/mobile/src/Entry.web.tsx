/**
 * @file Selects the public homepage, read-only starter trial, or browser app. Keep website copy/styles reachable only from this
 * web entry: native Entry.tsx must import only App. The homepage must not initialize the device library
 * or call app APIs. New PWA installs start at /app; older standalone root launches still enter App.
 */

import { lazy, Suspense } from 'react';
import LandingPage from './website/LandingPage.web';

const App = lazy(() => import('./App'));
const TryBoards = lazy(() => import('./website/TryBoards.web'));

/** Open /app/try without account services; preserve /app and older home-screen installs for the signed-in app. */
export default function WebEntry() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const appPath = /^\/app(?:\/|$)/.test(window.location.pathname);
  const legacyInstall = standalone && ['/', '/index.html'].includes(window.location.pathname);
  if (/^\/app\/try\/?$/.test(window.location.pathname)) return <Suspense fallback={<div role="status">Opening starter boards…</div>}><TryBoards /></Suspense>;
  return appPath || legacyInstall
    ? <Suspense fallback={<div role="status">Opening Little Say…</div>}><App /></Suspense>
    : <LandingPage />;
}
