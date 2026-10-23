/** @file Imports already inspected, server-validated generic results from an isolated evaluation as bundled generated assets, preserving model provenance. */

import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { genericConcepts } from '../apps/server/src/generic-concepts';
import { resolvedPictureSchema } from '@little-say/core';

const directory = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Provide the isolated evaluation directory after visually inspecting its contact sheets.');
const report = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'));
const summary = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'));
if (!report.generation || !report.results.length || report.results.some((row: { suitable: boolean; contentValid: boolean }) => !row.suitable || !row.contentValid)) throw new Error('Only complete, validated evaluation results may be imported.');
const output: Record<string, unknown> = {};
for (const folder of await readdir(directory, { withFileTypes: true })) {
  if (!folder.isDirectory() || !/^cold-\d+$/.test(folder.name)) continue;
  const root = join(directory, folder.name);
  for (const name of await readdir(join(root, 'generic'))) {
    if (!/^picture-[a-f0-9]{64}\.json$/.test(name)) continue;
    const record = JSON.parse(await readFile(join(root, 'generic', name), 'utf8'));
    const picture = resolvedPictureSchema.parse(record.picture);
    if (record.version !== 1 || picture.kind !== 'generated' || picture.style !== 'color' || !genericConcepts.some(item => !item.source && item.id === picture.description)) continue;
    const bytes = await readFile(join(root, 'pictures', `${picture.assetId}.png`));
    const metadata = await sharp(bytes).metadata();
    if (createHash('sha256').update(bytes).digest('hex') !== picture.assetId || metadata.format !== 'png' || !metadata.hasAlpha) throw new Error('Seed integrity check failed.');
    output[picture.description] = { version: 1, quality: summary.quality, validator: summary.models.match, picture, png: bytes.toString('base64') };
  }
}
if (!Object.keys(output).length) throw new Error('No eligible generic generated pictures found.');
await writeFile(resolve('apps/server/src/pictures/data/generated-picture-seeds.json'), JSON.stringify(output) + '\n');
console.log(JSON.stringify({ imported: Object.keys(output), quality: summary.quality, validator: summary.models.match }));
