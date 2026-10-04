import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { compositeImagesAsync, createSquareAsync, generateFaviconAsync, generateImageAsync } from '@expo/image-utils';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'apps/mobile/assets/brand');
const colors = JSON.parse(await readFile(resolve(directory, 'colors.json'), 'utf8'));
const source = resolve(directory, 'mountain-source.png');
await mkdir(directory, { recursive: true });

// Only resize and pad the generated artwork. Keep its original transparent master.
async function mark(size) {
  return (await generateImageAsync({ projectRoot: root, cacheType: 'little-say-brand' }, { src: source, width: size, height: size, resizeMode: 'contain' })).source;
}
async function icon(size, foregroundSize, backgroundColor) {
  const background = await createSquareAsync({ size, color: backgroundColor });
  return compositeImagesAsync({ foreground: await mark(foregroundSize), background, x: Math.round((size - foregroundSize) / 2), y: Math.round((size - foregroundSize) / 2) });
}
for (const [name, size] of [['mountain.png', 128], ['mountain@2x.png', 256], ['mountain@3x.png', 384], ['splash.png', 768]]) {
  await writeFile(resolve(directory, name), await mark(size));
}
// iOS icons have opaque, square backgrounds; the OS supplies the corner mask.
await writeFile(resolve(directory, 'app-icon.png'), await icon(1024, 960, colors.background));
// Android and PWA maskable variants keep essential art inside the central safe area.
await writeFile(resolve(directory, 'adaptive-foreground.png'), await icon(1024, 576, '#00000000'));
for (const size of [192, 512]) await writeFile(resolve(directory, `icon-${size}.png`), await icon(size, Math.round(size * 0.94), colors.background));
await writeFile(resolve(directory, 'icon-maskable-512.png'), await icon(512, 320, colors.background));
await writeFile(resolve(directory, 'apple-touch-icon.png'), await icon(180, 170, colors.background));
await writeFile(resolve(directory, 'favicon.png'), await icon(48, 48, colors.background));
await writeFile(resolve(directory, 'favicon.ico'), await generateFaviconAsync(await mark(128), [16, 32, 48]));
console.log('Generated Little Say icons, launch artwork, and UI image scales in apps/mobile/assets/brand.');
