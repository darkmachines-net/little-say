/**
 * @file Presents a compact web welcome with the mobile artwork and product promise, plus one /app entry.
 * Store links remain inactive until listings exist. Only Entry.web.tsx imports this page and its styles;
 * visiting it must not initialize the device library or start account/AI services.
 */

import type { CSSProperties } from 'react';
import { useWindowDimensions } from 'react-native';
import { WelcomeArtwork, welcomeBackground } from '../ui/account/AccountWelcome';
import colors from '../../assets/brand/colors.json';
import './landing.css';

function Arrow() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function StoreLinks() {
  return <div className="ls-stores" aria-label="App availability">
    <a className="ls-store" role="link" aria-disabled="true" aria-label="App Store — Coming soon">
      <svg width="26" height="29" viewBox="0 0 24 28" fill="currentColor" aria-hidden="true"><path d="M16.5 4.7c1-1.2 1.7-2.8 1.5-4.4-1.5.1-3.2 1-4.2 2.2-.9 1-1.7 2.6-1.5 4.1 1.6.1 3.2-.8 4.2-1.9ZM20.4 15.1c0-3.5 2.8-5.2 2.9-5.3-1.6-2.4-4.1-2.7-5-2.8-2.1-.2-4.1 1.3-5.2 1.3-1 0-2.6-1.3-4.4-1.2-2.3 0-4.5 1.4-5.7 3.5-2.5 4.2-.6 10.5 1.8 13.9 1.2 1.6 2.5 3.4 4.3 3.3 1.7-.1 2.4-1.1 4.5-1.1s2.7 1.1 4.5 1.1 3-1.6 4.1-3.2c1.3-1.9 1.8-3.7 1.8-3.8-.1 0-3.6-1.4-3.6-5.7Z" /></svg>
      <span><small>Coming soon</small><strong>App Store</strong></span>
    </a>
    <a className="ls-store" role="link" aria-disabled="true" aria-label="Google Play — Coming soon">
      <svg width="26" height="29" viewBox="0 0 26 29" fill="none" aria-hidden="true"><path d="m3 2 14 12.5L3 27V2Zm0 0 18 10-4 2.5L3 2Zm0 25 18-10-4-2.5L3 27Zm14-12.5 4-2.5 4 2.5-4 2.5-4-2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
      <span><small>Coming soon</small><strong>Google Play</strong></span>
    </a>
  </div>;
}

/** Introduce the app in one viewport, allowing scrolling on short screens or with enlarged text so entry stays reachable. */
export default function LandingPage() {
  const { width, height } = useWindowDimensions();
  const artWidth = width <= 760
    ? Math.max(140, Math.min(width - 48, height * 0.32, 300))
    : Math.max(180, Math.min(width * 0.4, height * 0.65, 420));
  const brandColors = { '--ls-background': welcomeBackground, '--ls-ink': colors.ink, '--ls-muted': colors.muted, '--ls-accent': colors.accent, '--ls-line': colors.line } as CSSProperties;
  return <div className="ls-site" style={brandColors}>
    <a className="ls-skip" href="#main">Skip to content</a>
    <main id="main" className="ls-welcome" tabIndex={-1}>
      <div className="ls-artwork"><WelcomeArtwork width={artWidth} /></div>
      <div className="ls-copy">
        <h1><span className="ls-brand">Little Say</span><span className="ls-title">Learn to Talk!</span></h1>
        <p className="ls-intro">Make your own custom speaking soundboards for learning new words in seconds.</p>
        <div className="ls-actions">
          <p className="ls-invitation">Free with no ads to support your child's learning.</p>
          <a className="ls-primary" href="/app">Try Little Say on the web <Arrow /></a>
          <StoreLinks />
        </div>
      </div>
    </main>
  </div>;
}
