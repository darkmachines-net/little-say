/** @file Reads compatible speech preferences and restores app-wide media defaults without altering boards. */

import { boardAudioTiles, canonicalLanguage } from './boardLanguages';
import { profileLanguages } from './languageProfile';
import type { Library, Settings } from './schema';

function locale(tag: string): string {
  try { return canonicalLanguage(tag) || tag; } catch { return tag; }
}

/** Resolve an exact locale's source, tolerating unfinished editor tags and preserving legacy opt-outs. */
export function speechSource(settings: Pick<Settings, 'voiceSources' | 'autoSpeech'>, language: string): 'ai' | 'device' {
  const canonical = locale(language);
  const explicit = Object.entries(settings.voiceSources ?? {}).find(([tag]) => locale(tag) === canonical)?.[1];
  return explicit ?? (settings.voiceSources === undefined && settings.autoSpeech === false ? 'device' : 'ai');
}

/** List preferred languages and every spoken board variant, canonicalized without duplicates. */
export function voiceLanguages(library: Pick<Library, 'settings' | 'boards'>): string[] {
  return [...new Set([...profileLanguages(library.settings), ...library.boards.flatMap(board => boardAudioTiles(board).map(tile => tile.language))].map(canonicalLanguage))];
}

/** Restore AI speech, automatic device matching, and default pictures on load; preserve all board content. */
export function migrateDeviceSettings(library: Library): Library {
  const settings = library.settings;
  const defaultVoices = settings.voiceSources !== undefined && !Object.keys(settings.voiceSources).length && !Object.keys(settings.voices).length;
  if (defaultVoices && settings.pictureDefaults === undefined && !settings.backendUrl && settings.autoSpeech) return library;
  return { ...library, settings: { ...settings, backendUrl: '', autoSpeech: true, voices: {}, voiceSources: {}, pictureDefaults: undefined } };
}
