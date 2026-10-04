/** @file Searches pinned licensed symbol metadata and rasterizes only catalog-owned source URLs. */

import sharp from 'sharp';
import { catalogEntrySchema, type CatalogEntry, type PicturePolicy } from '@little-say/core';
import data from './data/picture-catalog.json';

const catalog = data.map(entry => catalogEntrySchema.parse(entry));
const tokens = (value: string) => value.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const index = catalog.map(entry => ({ entry, words: new Set(tokens([entry.name, ...entry.terms].join(' '))) }));

/** Return at most twelve candidates from the selected style, ranked by exact names and matching words. */
export function searchPictures(query: string, style: PicturePolicy['style'], limit = 12): CatalogEntry[] {
  const words = tokens(query); if (!words.length) return [];
  return index.filter(item => item.entry.style === style).map(item => ({ entry: item.entry, score: words.reduce((score, word) => score + (item.words.has(word) ? 1 : 0), 0) + (item.entry.name.toLowerCase() === query.toLowerCase().trim() ? 10 : 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).slice(0, Math.min(12, limit)).map(item => item.entry);
}

/** Resolve a catalog-owned ID; callers cannot supply their own fetch URL or license metadata. */
export function catalogPicture(id: string): CatalogEntry | undefined { return catalog.find(entry => entry.id === id); }

/** Read an image response with a byte limit even when Content-Length is absent or inaccurate. */
export async function imageBytes(response: Response, limit = 8 * 1024 * 1024): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error('Picture download failed.');
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; if (size > limit) throw new Error('Picture is too large.');
      parts.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts);
}

/** Produce a bounded transparent PNG with padding, rejecting external SVG resources and invalid rasters. */
export async function normalizePicture(bytes: Buffer, svg = false): Promise<Buffer> {
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Picture is too large.');
  if (svg && /<!ENTITY|<!DOCTYPE|<script|<foreignObject|(?:href\s*=\s*["']\s*(?!#))|url\(\s*(?!#)/i.test(bytes.toString('utf8'))) throw new Error('Unsupported symbol resources.');
  const picture = sharp(bytes, { limitInputPixels: 16 * 1024 * 1024, failOn: 'error' });
  const metadata = await picture.metadata();
  if (!metadata.width || !metadata.height || (!svg && metadata.format !== 'png' && metadata.format !== 'webp')) throw new Error('Unsupported picture format.');
  return picture.resize(448, 448, { fit: 'inside' }).extend({ top: 24, bottom: 24, left: 24, right: 24, background: '#00000000' }).png().toBuffer();
}

/** Fetch one trusted pinned SVG without redirects and convert it into a portable PNG. */
export async function downloadCatalogPicture(entry: CatalogEntry): Promise<Buffer> {
  const trusted = catalogPicture(entry.id); if (!trusted) throw new Error('Unknown catalog picture.');
  const response = await fetch(trusted.provenance.sourceUrl, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  return normalizePicture(await imageBytes(response), true);
}
