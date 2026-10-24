/** @file Little Say metadata mirrors, input boundaries and application health assertions. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { trackedIdentity } from '@mchartier/expo-release';

/** Preserve every input byte except version fields allocated into the build commit. */
export function identity(root, source, inputs, platform) {
  return trackedIdentity(root, source, {
    include: file => inputs.some(p => file === p || file.startsWith(`${p}/`))
      && !/(^|\/)(__tests__|tests|docs)(\/|$)|\.(test|spec)\.|\.md$/.test(file)
      && !(platform && /\.(android|ios|web)\.[^.]+$/.test(file) && !file.includes(`.${platform}.`)),
    content: file => /package(-lock)?\.json$|native-release\.json$|release\.json$|app\.json$/.test(file) ? 'text' : 'blob',
    normalize: (file, text) => {
      const value = JSON.parse(text);
      delete value.version;
      if (file === 'native-release.json') { delete value.androidVersionCode; delete value.iosBuildNumber; }
      if (value.expo) delete value.expo.version;
      for (const [key, pkg] of Object.entries(value.packages ?? {})) if (!key.includes('node_modules')) delete pkg.version;
      return JSON.stringify(value);
    }
  });
}

/** Apply allocated versions to source metadata; EAS owns platform build counters. */
export function stamp(root, plan) {
  const edit = (file, update) => {
    const location = path.join(root, file), value = JSON.parse(fs.readFileSync(location));
    update(value); fs.writeFileSync(location, JSON.stringify(value, null, 2) + '\n');
  };
  if (plan.server) for (const file of ['release.json', 'package.json', 'apps/server/package.json']) edit(file, value => { value.version = plan.versions.server; });
  if (plan.bump) {
    for (const file of ['native-release.json', 'apps/mobile/package.json']) edit(file, value => { value.version = plan.versions.mobile; });
    edit('apps/mobile/app.json', value => { value.expo.version = plan.versions.mobile; });
  }
  edit('package-lock.json', value => {
    if (plan.server) value.version = value.packages[''].version = value.packages['apps/server'].version = plan.versions.server;
    if (plan.bump) value.packages['apps/mobile'].version = plan.versions.mobile;
  });
}

/** Dispatch application operations only; no provider calls or lifecycle state live in this repository. */
export async function applicationHook({ root, action, config, source, plan, target, baseUrl }) {
  if (action === 'inspect') return { server: identity(root, source, config.server.inputs),
    js: Object.fromEntries(['android', 'ios'].map(p => [p, identity(root, source, config.mobile.inputs, p)])) };
  if (action === 'prepare') { stamp(root, plan); return {}; }
  if (action === 'validate') {
    execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'scripts/tsconfig.json'], { cwd: root, env: process.env, stdio: ['ignore', 2, 2] });
    return {};
  }
  if (action === 'verify' && target === 'server') {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) throw new Error('Expected isolated smoke container.');
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    const health = await response.json();
    if (!response.ok || health.status !== 'ok' || health.version !== plan.versions.server) throw new Error('Server health/version differs.');
    return {};
  }
  throw new Error(`Unsupported application hook: ${action}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await applicationHook(JSON.parse(fs.readFileSync(0, 'utf8')));
  process.stdout.write(JSON.stringify(result) + '\n');
}
