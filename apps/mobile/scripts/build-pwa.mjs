/** @file Adds install metadata, brand assets, and an offline service worker to the exported web app. */

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { generateSW } from 'workbox-build';

const brand = new URL('../assets/brand/', import.meta.url);
const colors = JSON.parse(await readFile(new URL('colors.json', brand), 'utf8'));
const description = 'Create and play picture soundboards with spoken words.';
const manifest = { id: '/', name: 'Little Say', short_name: 'Little Say', start_url: '/', scope: '/', display: 'standalone', background_color: colors.background, theme_color: colors.background, description, icons: [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
] };
await writeFile('dist/manifest.webmanifest', JSON.stringify(manifest, null, 2));
for (const file of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon.png', 'favicon.ico']) await copyFile(new URL(file, brand), `dist/${file}`);
let html = await readFile('dist/index.html', 'utf8');
// Replace Expo's favicon link so every install surface uses this same identity.
html = html.replace(/<link\b[^>]*\brel=["'](?:shortcut )?icon["'][^>]*>/gi, '');
html = html.replace('</head>', `<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" type="image/png" sizes="48x48" href="/favicon.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><meta name="theme-color" content="${colors.background}"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Little Say"><meta name="description" content="${description}"><style>html,body,#root{height:100%;margin:0;background:${colors.background}}button:focus-visible,[role=button]:focus-visible{outline:3px solid ${colors.accent};outline-offset:3px}body{overscroll-behavior:none}</style></head>`);
await writeFile('dist/index.html', html);
const result = await generateSW({ globDirectory: 'dist', globPatterns: ['**/*.{html,js,css,svg,png,ico,ttf,woff2,webmanifest}'], swDest: 'dist/sw.js', maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, skipWaiting: false, clientsClaim: true, cleanupOutdatedCaches: true, navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api\//], runtimeCaching: [] });
console.log(`Offline shell: ${result.count} assets (${Math.round(result.size / 1024)} KiB). Updates wait for parent action.`);
for (const warning of result.warnings) console.warn(warning);
