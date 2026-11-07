/**
 * @file Routes the public homepage and starter trial without reloading, preloads the trial on intent,
 * and centers a full-screen spinner while web code loads. Native Entry.tsx must import only App.
 * Public pages never initialize the device library; trial speech reads the shared server cache. PWA installs start at /app;
 * older standalone root launches still enter App.
 */

import { lazy, Suspense, useEffect, useState, type MouseEvent } from 'react';
import { ActivityIndicator } from 'react-native';
import LandingPage from './website/LandingPage.web';
import colors from '../assets/brand/colors.json';

const App = lazy(() => import('./App'));
const loadTrial = () => import('./website/TryBoards.web');
const TryBoards = lazy(loadTrial);

function PageLoading() {
  return <div data-testid="web-loading" aria-busy="true" style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
    <ActivityIndicator size="large" color={colors.accent} accessibilityLabel="Loading Little Say" />
  </div>;
}

/** Keep trial navigation and Back/Forward in the current page; preserve real links, account entry, and installed-app routing. */
export default function WebEntry() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const changed = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const appPath = /^\/app(?:\/|$)/.test(pathname);
  const legacyInstall = standalone && ['/', '/index.html'].includes(pathname);
  const openTrial = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState(null, '', event.currentTarget.href);
    setPathname(window.location.pathname);
  };
  if (/^\/app\/try\/?$/.test(pathname)) return <Suspense fallback={<PageLoading />}><TryBoards /></Suspense>;
  return appPath || legacyInstall
    ? <Suspense fallback={<PageLoading />}><App /></Suspense>
    : <LandingPage onTry={openTrial} onTryIntent={() => { void loadTrial().catch(() => {}); }} />;
}
