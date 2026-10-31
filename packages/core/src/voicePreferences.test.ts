/** @file Verifies default media migration preserves boards and unrelated settings, plus compatible speech-source lookup. */

import { describe, expect, it } from 'vitest';
import { starterLibrary } from '../../../tests/fixtures/library';
import { migrateDeviceSettings, speechSource } from './voicePreferences';
import { defaultPicturePolicy } from './pictures';

describe('managed device settings', () => {
  it('restores media defaults for legacy opt-outs without changing boards or unrelated settings', () => {
    const library = starterLibrary();
    library.settings.autoSpeech = false; library.settings.backendUrl = 'https://obsolete.example';
    library.settings.voices = { 'en-US': 'saved-device-voice', 'fr-FR': 'saved-french' };
    library.settings.pictureDefaults = { ...defaultPicturePolicy, mode: 'emoji' };
    library.settings.activeBoardId = library.boards[0].id;
    library.settings.accountChoiceMade = true;
    library.boards[0].picturePolicy = { ...defaultPicturePolicy, mode: 'library' };
    const migrated = migrateDeviceSettings(library);
    expect(migrated.boards).toBe(library.boards);
    expect(migrated.boards[0].picturePolicy?.mode).toBe('library');
    expect(migrated.settings).toEqual({ ...library.settings, backendUrl: '', autoSpeech: true, voices: {}, voiceSources: {}, pictureDefaults: undefined });
    expect(speechSource(migrated.settings, 'en-US')).toBe('ai');
    expect(speechSource(migrated.settings, 'fr-FR')).toBe('ai');
    expect(migrateDeviceSettings(migrated)).toBe(migrated);
    expect(library.settings.backendUrl).toBe('https://obsolete.example');
    expect(library.settings.pictureDefaults.mode).toBe('emoji');
    expect(library.settings.voices['en-US']).toBe('saved-device-voice');
  });
  it('clears explicit language sources on load and defaults every language to AI without a consent gate', () => {
    const library = starterLibrary();
    library.settings.aiConsent = false;
    library.settings.voiceSources = { 'en-US': 'device', 'es-ES': 'ai' };
    const migrated = migrateDeviceSettings(library);
    expect(migrated.settings.voiceSources).toEqual({});
    for (const language of ['en-us', 'en-GB', 'es-ES', 'ru-RU']) expect(speechSource(migrated.settings, language)).toBe('ai');
    expect(migrateDeviceSettings(migrated)).toBe(migrated);
  });
  it('can still read exact-locale sources from older settings before device migration', () => {
    const settings = { autoSpeech: false, voiceSources: { 'en-US': 'device' as const, 'es-ES': 'ai' as const } };
    expect(speechSource(settings, 'en-us')).toBe('device');
    expect(speechSource(settings, 'en-GB')).toBe('ai');
    expect(speechSource(settings, 'es-ES')).toBe('ai');
    expect(speechSource(settings, 'e-')).toBe('ai');
    expect(speechSource({ autoSpeech: false }, 'en-US')).toBe('device');
  });
});
