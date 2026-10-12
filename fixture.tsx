/** @file Renders the real parent settings with synthetic account data and a recorded local-save fixture. */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ParentSettings } from '@subject/ParentSettings';

const scenario = new URLSearchParams(location.search).get('scenario') || 'idle';
window.__otaEvidence = { events: [], saved: null };
const settings = {
  backendUrl: 'https://example.invalid/', voices: {}, activeBoardId: null,
  aiConsent: false, autoSpeech: true,
  languageProfile: { languages: ['en-US'], defaultLanguage: 'en-US' },
};
createRoot(document.getElementById('root')!).render(<ParentSettings
  visible settings={settings} languages={['en-US']}
  voices={[{ identifier: 'fixture-en', name: 'English fixture voice', language: 'en-US', localService: true }]}
  account={{ session: null, busy: false, error: '' }}
  onAccount={() => {}} onClose={() => {}} onPreview={() => {}}
  onSave={async value => {
    window.__otaEvidence.events.push('save');
    if (scenario === 'save-error') throw new Error('Simulated storage failure');
    window.__otaEvidence.saved = value;
  }}
/>);
