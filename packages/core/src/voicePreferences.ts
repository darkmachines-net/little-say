/** @file Resolves per-language speech sources and migrates legacy local settings without altering boards. */

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

/** List preferred languages and every spoken board variant so existing boards remain configurable. */
export function voiceLanguages(library: Pick<Library, 'settings' | 'boards'>): string[] {
  return [...new Set([...profileLanguages(library.settings), ...library.boards.flatMap(board => boardAudioTiles(board).map(tile => tile.language))].map(canonicalLanguage))];
}

/** Clear obsolete endpoint overrides and translate legacy AI opt-outs into per-language choices once. */
export function migrateDeviceSettings(library: Library): Library {
  const settings = library.settings;
  if (settings.voiceSources !== undefined && !settings.backendUrl && settings.autoSpeech) return library;
  const languages = [...voiceLanguages(library), ...Object.keys(settings.voices)];
  const voiceSources = settings.voiceSources ?? Object.fromEntries(languages.map(tag => [locale(tag), speechSource(settings, tag)]));
  return { ...library, settings: { ...settings, backendUrl: '', autoSpeech: true, voiceSources } };
}
