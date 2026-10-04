/** @file Rebuilds the checked-in emoji search catalog from Unicode emoji and CLDR annotations. */

import { mkdir, writeFile } from 'node:fs/promises';

// Pin data releases so normal app builds never depend on a network request.
const unicodeVersion = '17.0';
const cldrVersion = '48.0.0';
const unicodeUrl = `https://www.unicode.org/Public/${unicodeVersion}.0/emoji/emoji-test.txt`;
const cldrRoot = `https://raw.githubusercontent.com/unicode-org/cldr-json/${cldrVersion}`;
const locales = ['en', 'ru'];
const annotationUrls = locales.flatMap(locale => [
  `${cldrRoot}/cldr-json/cldr-annotations-full/annotations/${locale}/annotations.json`,
  `${cldrRoot}/cldr-json/cldr-annotations-derived-full/annotationsDerived/${locale}/annotations.json`,
]);
const licenseUrl = `${cldrRoot}/LICENSE`;
const sources = [unicodeUrl, ...annotationUrls, licenseUrl];
const downloaded = await Promise.all(sources.map(async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`);
  return response.text();
}));
type Annotation = { default?: string[]; tts?: string[] };
const key = (value: string) => value.replace(/\uFE0F/g, '');
const annotations = locales.map((_, index) => {
  const merged = new Map<string, Annotation>();
  for (const source of downloaded.slice(1 + index * 2, 3 + index * 2)) {
    const document = JSON.parse(source);
    const entries: Record<string, Annotation> = (document.annotations ?? document.annotationsDerived).annotations;
    for (const [emoji, annotation] of Object.entries(entries)) merged.set(key(emoji), annotation);
  }
  return merged;
});
const entries: [string, string, string][] = [];
let group = '', subgroup = '';
for (const line of downloaded[0].split(/\r?\n/)) {
  if (line.startsWith('# group: ')) group = line.slice(9);
  if (line.startsWith('# subgroup: ')) subgroup = line.slice(12).replace(/-/g, ' ');
  const match = /^([A-F0-9 ]+);\s*(?:fully-qualified|component)\s*#\s*\S+\s+E[\d.]+\s+(.+)$/.exec(line);
  if (!match) continue;
  const emoji = String.fromCodePoint(...match[1].trim().split(/\s+/).map(code => parseInt(code, 16)));
  const names = annotations.map(locale => locale.get(key(emoji)));
  const label = names[0]?.tts?.[0] ?? match[2];
  const keywords = [...new Set([label, match[2], group, subgroup, ...names.flatMap(name => [...(name?.default ?? []), ...(name?.tts ?? [])])])].join(' ');
  entries.push([emoji, label, keywords]);
}
if (!downloaded[0].includes(`# Version: ${unicodeVersion}`) || entries.length < 3000 || new Set(entries.map(([emoji]) => emoji)).size !== entries.length || entries.some(([emoji]) => emoji.length > 32)) throw new Error('Unexpected emoji data; review the input before updating.');
const destination = new URL('../packages/core/src/data/', import.meta.url);
await mkdir(destination, { recursive: true });
const metadata = JSON.stringify({ unicodeVersion, cldrVersion, sources, license: 'UNICODE-LICENSE.txt' }, null, 2).slice(0, -2);
await writeFile(new URL('emoji-catalog.json', destination), `${metadata},\n  "emoji": [\n${entries.map(entry => `    ${JSON.stringify(entry)}`).join(',\n')}\n  ]\n}\n`);
await writeFile(new URL('UNICODE-LICENSE.txt', destination), downloaded.at(-1)!);
console.log(`Saved ${entries.length} emoji with English and Russian search terms (Unicode ${unicodeVersion}, CLDR ${cldrVersion}).`);
