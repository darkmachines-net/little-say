/** @file Bundles baseline or PR-head Android UI for comparison, restoring source bytes in finally. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const kind = process.argv[2];
const platform = process.argv[3] ?? 'android';
if (!['baseline', 'head'].includes(kind)) throw new Error('Expected baseline or head.');
const root = process.cwd();
const paths = ['apps/mobile/src/App.tsx', 'apps/mobile/src/ui/components.tsx', 'apps/mobile/src/ui/AccountScreen.tsx'];
const originals = paths.map(path => [path, readFileSync(path)]);
const source = execFileSync('git', ['rev-parse', kind === 'baseline' ? 'origin/master' : 'HEAD'], { encoding: 'utf8' }).trim();
const directory = resolve('artifacts/pr-safe-area', kind);
mkdirSync(directory, { recursive: true });
try {
  if (kind === 'baseline') for (const path of paths) writeFileSync(path, execFileSync('git', ['show', `${source}:${path}`]));
  if (platform === 'web') {
    execFileSync(process.execPath, [resolve('node_modules/expo/bin/cli'), 'export', '--platform', 'web'], { cwd: resolve('apps/mobile'), env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit' });
    execFileSync(process.execPath, ['scripts/build-pwa.mjs'], { cwd: resolve('apps/mobile'), stdio: 'inherit' });
  } else {
    execFileSync(process.execPath, [resolve('node_modules/expo/bin/cli'), 'export:embed', '--platform', 'android', '--dev', 'false', '--entry-file', 'index.ts', '--bundle-output', 'android/app/src/main/assets/index.android.bundle', '--assets-dest', 'android/app/src/main/res'], { cwd: resolve('apps/mobile'), env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit' });
    const bundle = readFileSync(resolve(root, 'apps/mobile/android/app/src/main/assets/index.android.bundle'));
    writeFileSync(resolve(directory, 'bundle.json'), JSON.stringify({ source, platform: 'android', dev: false, sha256: createHash('sha256').update(bundle).digest('hex') }, null, 2));
  }
} finally {
  for (const [path, bytes] of originals) writeFileSync(path, bytes);
}
