/** @file Downloads pinned public symbol metadata and writes the licensed, searchable server catalog. */

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { type CatalogEntry, catalogEntrySchema } from '@little-say/core';

const mulberry = '9cbab9f400c5de44e2bc58839cca07294aadb086';
const openmoji = 'f9fc506a3f913be9897ab0181d611d4c910a4104';
async function download(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Catalog download failed: ${response.status}`);
  return response.text();
}
function csvLine(line: string): string[] {
  const values: string[] = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (quoted && line[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { values.push(value); value = ''; } else value += c;
  }
  values.push(value); return values;
}
const rows = (await download(`https://raw.githubusercontent.com/mulberrysymbols/mulberry-symbols/${mulberry}/scripts/data/symbol-info-en.csv`)).trim().split(/\r?\n/).slice(1).map(csvLine);
const entries: CatalogEntry[] = rows.map(([id, symbol, , , category, , tags]) => ({
  id: `mulberry-${id}`, name: symbol.replaceAll('_', ' '), terms: [symbol.replaceAll('_', ' '), category, tags].filter(Boolean), style: 'color',
  provenance: { library: 'mulberry', sourceId: symbol, sourceUrl: `https://raw.githubusercontent.com/mulberrysymbols/mulberry-symbols/${mulberry}/EN/${encodeURIComponent(symbol)}.svg`, author: 'Mulberry Symbols by Steve Lee', license: 'CC-BY-SA-4.0', modified: 'Rasterized and fitted to a transparent square; original artwork unchanged.' },
}));
const emojis = JSON.parse(await download(`https://raw.githubusercontent.com/hfg-gmuend/openmoji/${openmoji}/data/openmoji.json`)) as { hexcode: string; annotation: string; tags: string; openmoji_tags: string }[];
entries.push(...emojis.map(emoji => ({
  id: `openmoji-${emoji.hexcode}`, name: emoji.annotation, terms: [emoji.annotation, emoji.tags, emoji.openmoji_tags].filter(Boolean), style: 'line' as const,
  provenance: { library: 'openmoji' as const, sourceId: emoji.hexcode, sourceUrl: `https://raw.githubusercontent.com/hfg-gmuend/openmoji/${openmoji}/black/svg/${emoji.hexcode}.svg`, author: 'OpenMoji contributors, HfG Schwäbisch Gmünd', license: 'CC-BY-SA-4.0' as const, modified: 'Rasterized and fitted to a transparent square; original artwork unchanged.' },
})));
const output = new URL('../apps/server/src/pictures/data/catalog.json', import.meta.url);
await mkdir(fileURLToPath(new URL('.', output)), { recursive: true });
await writeFile(output, `${JSON.stringify(entries.map(entry => catalogEntrySchema.parse(entry)))}\n`);
console.log(`Saved ${entries.length} pinned picture records.`);
