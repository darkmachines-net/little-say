import { type Board, type Library, type LanguageProfile, colors } from './schema';
import { initialLanguageProfile } from './languageProfile';
export const languages = [
  { tag: 'en-US', name: 'English', short: 'EN' }, { tag: 'ru-RU', name: 'Russian', short: 'RU' },
  { tag: 'es-ES', name: 'Spanish', short: 'ES' }, { tag: 'fr-FR', name: 'French', short: 'FR' },
  { tag: 'de-DE', name: 'German', short: 'DE' }, { tag: 'it-IT', name: 'Italian', short: 'IT' },
  { tag: 'pt-BR', name: 'Portuguese', short: 'PT' }, { tag: 'zh-CN', name: 'Mandarin', short: 'ZH' },
  { tag: 'ja-JP', name: 'Japanese', short: 'JA' }, { tag: 'ko-KR', name: 'Korean', short: 'KO' },
  { tag: 'ar-SA', name: 'Arabic', short: 'AR' }, { tag: 'hi-IN', name: 'Hindi', short: 'HI' },
  { tag: 'uk-UA', name: 'Ukrainian', short: 'UK' }, { tag: 'pl-PL', name: 'Polish', short: 'PL' },
  { tag: 'nl-NL', name: 'Dutch', short: 'NL' }, { tag: 'sv-SE', name: 'Swedish', short: 'SV' },
  { tag: 'tr-TR', name: 'Turkish', short: 'TR' }, { tag: 'vi-VN', name: 'Vietnamese', short: 'VI' },
  { tag: 'id-ID', name: 'Indonesian', short: 'ID' }, { tag: 'he-IL', name: 'Hebrew', short: 'HE' },
];
export function languageName(tag: string): string {
  const known = languages.find(language => language.tag === tag);
  if (known) return known.name;
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag; }
  catch { return tag; }
}

export function starterLibrary(languageProfile: LanguageProfile = initialLanguageProfile()): Library {
  const now = new Date().toISOString();
  const board = (id: string, title: string, entries: string[][]): Board => ({ id, title, revision: 0, createdAt: now, updatedAt: now,
    tiles: entries.map(([label, emoji, speech, language], i) => ({ id: `${id}-${i}`, label, speech: speech ?? label, language: language ?? 'en-US', color: colors[i % colors.length], illustration: { kind: 'emoji', emoji } })) });
  return { version: 1, settings: { backendUrl: '', voices: {}, activeBoardId: null, aiConsent: false, autoSpeech: true, languageProfile }, boards: [
    board('starter-farm', 'Farmyard friends', [['Cow','🐄'],['Sheep','🐑'],['Horse','🐴'],['Pig','🐷'],['Chicken','🐔'],['Duck','🦆']]),
    board('starter-everyday', 'My little words', [['More','➕'],['Water','💧'],['Help','🙋'],['All done','👋'],['Eat','🍽️'],['Love you','❤️']]),
    board('starter-family', 'Our family', [['Mama','👩'],['Papa','👨'],['Grandma','👵'],['Grandpa','👴'],['Babushka','👵','бабушка','ru-RU'],['Dedushka','👴','дедушка','ru-RU']]),
  ] };
}
