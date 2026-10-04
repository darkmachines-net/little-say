export const languages = [
  { tag: 'en-US', name: 'English' }, { tag: 'ru-RU', name: 'Russian' },
  { tag: 'es-ES', name: 'Spanish' }, { tag: 'fr-FR', name: 'French' },
  { tag: 'de-DE', name: 'German' }, { tag: 'it-IT', name: 'Italian' },
  { tag: 'pt-BR', name: 'Portuguese' }, { tag: 'zh-CN', name: 'Mandarin' },
  { tag: 'ja-JP', name: 'Japanese' }, { tag: 'ko-KR', name: 'Korean' },
  { tag: 'ar-SA', name: 'Arabic' }, { tag: 'hi-IN', name: 'Hindi' },
  { tag: 'uk-UA', name: 'Ukrainian' }, { tag: 'pl-PL', name: 'Polish' },
  { tag: 'nl-NL', name: 'Dutch' }, { tag: 'sv-SE', name: 'Swedish' },
  { tag: 'tr-TR', name: 'Turkish' }, { tag: 'vi-VN', name: 'Vietnamese' },
  { tag: 'id-ID', name: 'Indonesian' }, { tag: 'he-IL', name: 'Hebrew' },
];
export function languageName(tag: string): string {
  const known = languages.find(language => language.tag === tag);
  if (known) return known.name;
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag; }
  catch { return tag; }
}
