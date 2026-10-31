/**
 * @file Presents the public, web-only feature overview using the shared mountain identity and palette.
 * Describe implemented features and account-based web access, link into /app, and keep store links inactive until listings exist.
 * Entry.web.tsx is the only entry owner; native bundles must never import this page or its styles.
 */

import type { CSSProperties } from 'react';
import { MountainMark } from '../ui/Brand';
import colors from '../../assets/brand/colors.json';
import './landing.css';

const cards = [
  { word: 'Water', picture: '💧', color: 'sky' },
  { word: 'More', picture: '➕', color: 'butter' },
  { word: 'Help', picture: '🤝', color: 'peach' },
  { word: 'Eat', picture: '🍎', color: 'rose' },
  { word: 'Play', picture: '🧸', color: 'lilac' },
  { word: 'Love you', picture: '❤️', color: 'sage' },
];

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

/** Describe the app and account-based access without initializing a library or starting account/AI services. */
export default function LandingPage() {
  const brandColors = { '--ls-background': colors.background, '--ls-ink': colors.ink, '--ls-muted': colors.muted, '--ls-accent': colors.accent, '--ls-line': colors.line } as CSSProperties;
  return <div className="ls-site" style={brandColors}>
    <a className="ls-skip" href="#main">Skip to content</a>
    <header className="ls-header ls-container">
      <div className="ls-brand"><MountainMark size={48} /><span>Little Say</span></div>
      <nav aria-label="Main navigation">
        <a className="ls-nav-detail" href="#features">Features</a>
        <a className="ls-nav-detail" href="#how-it-works">How it works</a>
        <a className="ls-open" href="/app">Open web app <Arrow /></a>
      </nav>
    </header>

    <main id="main" tabIndex={-1}>
      <section className="ls-hero ls-container" aria-labelledby="hero-title">
        <div className="ls-hero-copy">
          <p className="ls-eyebrow"><span /> A little more connection</p>
          <h1 id="hero-title">Little words.<br /><span>Big possibilities.</span></h1>
          <p className="ls-intro">A picture. A tap. A way to say it. Little Say helps you create talking picture boards for your child’s everyday world.</p>
          <p className="ls-hero-detail">From “more, please” to “love you,” make space for what they want to share.</p>
          <a className="ls-primary" href="/app">Try Little Say on the web <Arrow /></a>
          <p className="ls-no-account">Sign in to keep your boards backed up and in sync.</p>
          <StoreLinks />
        </div>
        <div className="ls-hero-visual">
          <div className="ls-mountain"><MountainMark size={132} /></div>
          <figure className="ls-board" aria-labelledby="board-caption">
            <div className="ls-board-header"><span>My everyday words</span><svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none"><rect x="6" y="10" width="12" height="11" rx="3" stroke="currentColor" strokeWidth="1.7" /><path d="M9 10V6a3 3 0 0 1 6 0v4" stroke="currentColor" strokeWidth="1.7" /></svg></div>
            <div className="ls-board-grid">
              {cards.map(card => <div className={`ls-tile ls-${card.color}`} key={card.word}><span aria-hidden="true">{card.picture}</span><strong>{card.word}</strong></div>)}
            </div>
            <figcaption id="board-caption"><span aria-hidden="true">✦</span> A few little words for a big day <span className="ls-example">Example board</span></figcaption>
          </figure>
          <div className="ls-visual-note"><span aria-hidden="true">↳</span> Made for their world. And their little hands.</div>
        </div>
      </section>

      <div className="ls-values"><div className="ls-container"><span>Made personal by you</span><span>Room for every language</span><span>Ready for everyday life</span></div></div>

      <section className="ls-features ls-container" id="features" aria-labelledby="features-title">
        <div className="ls-section-heading"><p className="ls-eyebrow">Their world, in their words</p><h2 id="features-title">Small touches.<br />So many ways to connect.</h2><p>Flexible AAC picture boards, thoughtfully made for parents and little communicators.</p></div>
        <div className="ls-feature-grid">
          <article><span className="ls-feature-icon ls-peach" aria-hidden="true">✿</span><h3>Familiar faces. Favorite things.</h3><p>Make each board feel like home with your own photos, colorful illustrations, or emoji. Choose the words that matter to your family.</p></article>
          <article><span className="ls-feature-icon ls-lilac" aria-hidden="true">✦</span><h3>A little help getting started.</h3><p>Describe a board by typing or speaking, and let AI help with a first draft. Review it, make it yours, and save when you’re ready. You can build manually, too.</p></article>
          <article><span className="ls-feature-icon ls-sky" aria-hidden="true">Aa</span><h3>More than one way to say it.</h3><p>Create multilingual boards and switch languages during play. Personalize individual cards for family names and the words you use at home.</p></article>
          <article><span className="ls-feature-icon ls-butter" aria-hidden="true">☀</span><h3>Little hands, welcome.</h3><p>Big, colorful tiles respond to taps and swipes with spoken words. A hold-to-unlock parent control helps keep the focus on the board.</p></article>
          <article><span className="ls-feature-icon ls-sage" aria-hidden="true">♫</span><h3>Everyday words, on the go.</h3><p>Keep saved boards, pictures, and downloaded speech on your device for offline play. Creating AI content needs a connection; using prepared boards doesn’t.</p></article>
          <article><span className="ls-feature-icon ls-rose" aria-hidden="true">♡</span><h3>Your family. Your choice.</h3><p>Sign in on the web or mobile to keep your boards backed up and in sync. Build manually or choose AI help, with every draft yours to review before saving.</p></article>
        </div>
      </section>

      <section className="ls-how" id="how-it-works" aria-labelledby="how-title"><div className="ls-container">
        <div className="ls-section-heading"><p className="ls-eyebrow">A simple place to begin</p><h2 id="how-title">From your idea to their voice.</h2></div>
        <ol className="ls-steps">
          <li><span>01</span><h3>Start with their day</h3><p>Snack time, favorite animals, or people they love. Pick a moment and choose your languages.</p></li>
          <li><span>02</span><h3>Make a board together</h3><p>Build it yourself or ask AI for ideas. Choose pictures, adjust the words, and check how they sound.</p></li>
          <li><span>03</span><h3>Give them room to share</h3><p>Open the board and let them explore. A tap on a picture says the word out loud.</p></li>
        </ol>
      </div></section>

      <section className="ls-final ls-container" aria-labelledby="start-title">
        <MountainMark size={108} /><p className="ls-eyebrow">Every little say matters</p><h2 id="start-title">Make room for their words.</h2><p>Start with one board. Fill it with their world.</p>
        <a className="ls-primary" href="/app">Try Little Say on the web <Arrow /></a>
        <StoreLinks />
      </section>
    </main>
    <footer className="ls-footer ls-container"><span>Little Say</span><p>A little more connection, every day.</p><a href="/app">Open web app <Arrow /></a></footer>
  </div>;
}
