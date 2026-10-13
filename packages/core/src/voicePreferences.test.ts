/** @file Verifies legacy speech-choice migration, exact-locale preferences, and preservation of boards and device voices. */

import { describe, expect, it } from 'vitest';
import { starterLibrary } from '../../../tests/fixtures/library';
import { migrateDeviceSettings, speechSource, voiceLanguages } from './voicePreferences';
import { boardAudioTiles } from './boardLanguages';

describe('managed device settings', () => {
  it('migrates a legacy AI opt-out for every spoken language without changing boards or device IDs', () => {
    const library = starterLibrary();
    library.settings.autoSpeech = false; library.settings.backendUrl = 'https://obsolete.example';
    library.settings.voices = { 'en-US': 'saved-device-voice', 'fr-FR': 'saved-french' };
    const migrated = migrateDeviceSettings(library);
    expect(migrated.boards).toBe(library.boards);
    expect(migrated.settings.voices).toBe(library.settings.voices);
    expect(migrated.settings.backendUrl).toBe('');
    for (const language of [...voiceLanguages(library), 'fr-FR']) expect(speechSource(migrated.settings, language)).toBe('device');
    expect(migrateDeviceSettings(migrated)).toBe(migrated);
    expect(library.settings.backendUrl).toBe('https://obsolete.example');
  });
  it('uses AI by default without the old consent gate, and keeps explicit mixed sources on reloading', () => {
    const library = starterLibrary();
    library.settings.aiConsent = false;
    const migrated = migrateDeviceSettings(library);
    expect(speechSource(migrated.settings, 'en-US')).toBe('ai');
    migrated.settings.voiceSources = { 'en-US': 'device', 'es-ES': 'ai' };
    expect(speechSource(migrated.settings, 'en-us')).toBe('device');
    expect(speechSource(migrated.settings, 'en-GB')).toBe('ai');
    expect(speechSource(migrated.settings, 'es-ES')).toBe('ai');
    expect(speechSource(migrated.settings, 'e-')).toBe('ai');
    const eligible = migrated.boards.flatMap(boardAudioTiles).filter(tile => speechSource(migrated.settings, tile.language) === 'ai');
    expect(eligible.some(tile => tile.language === 'en-US')).toBe(false);
    expect(eligible.some(tile => tile.language === 'ru-RU')).toBe(true);
    expect(migrateDeviceSettings(migrated)).toBe(migrated);
  });
});
