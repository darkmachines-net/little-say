/** @file Hashes release-relevant Git inputs and resolved npm dependency closures, ignoring version allocation and tests. */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { posix } from 'node:path';
import { assert, git, root } from './source-common';

/** Hash structured input deterministically, independent of JSON property insertion order. */
export function hash(value: unknown): string {
  const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(stable(value)) ?? 'undefined').digest('hex');
}

/** Remove only workflow-allocated version fields, preserving all executable configuration. */
export function withoutVersions(path: string, value: any): any {
  const v = structuredClone(value);
  if (path === 'native-release.json') { delete v.version; delete v.androidVersionCode; delete v.iosBuildNumber; }
  else if (path === 'apps/mobile/app.json') { delete v.expo.version; }
  else if (path.endsWith('package.json') || path === 'release.json') delete v.version;
  return v;
}

/** Resolve workspace links and nested lockfile dependencies using npm's nearest-package lookup. */
export function dependencyClosure(lock: any, workspace: string, tools: string[] = [], excluded = new Set<string>()): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const packages = lock.packages || {};
  const dependencies = (values: any) => values ? Object.fromEntries(Object.entries(values).filter(([name]) => !excluded.has(name))) : undefined;
  function lookup(from: string, name: string): string | undefined {
    let location = from;
    for (;;) {
      const candidate = posix.join(location, 'node_modules', name);
      if (packages[candidate]) return candidate;
      if (!location || location === '.') return undefined;
      location = posix.dirname(location); if (location === '.') location = '';
    }
  }
  function visit(path: string) {
    if (path in result) return;
    const pkg = packages[path];
    if (!pkg) return;
    if (pkg.link) { result[path] = { link: pkg.resolved }; visit(pkg.resolved); return; }
    result[path] = { version: path.includes('node_modules/') ? pkg.version : undefined, integrity: pkg.integrity, resolved: pkg.resolved, dependencies: dependencies(pkg.dependencies), optionalDependencies: dependencies(pkg.optionalDependencies), peerDependencies: dependencies(pkg.peerDependencies) };
    for (const name of new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.optionalDependencies || {}), ...Object.keys(pkg.peerDependencies || {})])) {
      const found = !excluded.has(name) && lookup(path, name); if (found) visit(found);
    }
  }
  visit(workspace);
  for (const name of tools) { const found = lookup(workspace, name); if (found) visit(found); }
  return result;
}

/** Identify source/configuration consumed by a target, excluding other-platform implementations and test inputs. */
export function relevantFile(path: string, target: 'server' | 'web' | 'android' | 'ios', all: Set<string>): boolean {
  if (/(^|\/)(__tests__|test|tests|fixtures|docs)(\/|$)|\.(test|spec)\.|\.md$/.test(path)) return false;
  const platform = target === 'server' ? 'web' : target;
  if (path.startsWith('packages/') || path.startsWith('apps/mobile/')) {
    const variant = /\.(android|ios|web|native)\.[^.]+$/.exec(path)?.[1];
    if (variant && variant !== platform && !(variant === 'native' && platform !== 'web')) return false;
    if (variant === 'native' && all.has(path.replace('.native.', `.${platform}.`))) return false;
    if (!variant && /\.[jt]sx?$/.test(path) && [platform, ...(platform === 'web' ? [] : ['native'])].some(p => all.has(path.replace(/(\.[jt]sx?)$/, `.${p}$1`)))) return false;
  }
  if (/^packages\/[^/]+\/(src|assets)\//.test(path)) return true;
  if (target === 'server' && (path.startsWith('apps/server/src/') || path.startsWith('apps/server/migrations/') || ['Dockerfile', '.dockerignore', 'apps/server/tsup.config.ts', 'apps/server/tsconfig.json'].includes(path))) return true;
  if (['tsconfig.base.json', '.npmrc'].includes(path) || /^packages\/[^/]+\/tsconfig.json$/.test(path)) return true;
  if (!path.startsWith('apps/mobile/')) return false;
  // These generated assets are consumed only by the PWA build/config, not native bundles.
  if (platform !== 'web' && (/^apps\/mobile\/assets\/web\//.test(path) || /^apps\/mobile\/assets\/brand\/(favicon(\.png|\.ico)|icon-(192|512|maskable-512)\.png|apple-touch-icon\.png)$/.test(path))) return false;
  if (path === 'apps/mobile/assets/brand/mountain-source.png') return false;
  // Resolved app configuration and native launcher/splash assets belong to the native fingerprint.
  // A configuration-only build embeds its new config; it does not imply a JavaScript OTA change.
  if (platform !== 'web' && (['apps/mobile/app.json', 'apps/mobile/app.config.js', 'apps/mobile/release-metadata.cjs'].includes(path) || /^apps\/mobile\/assets\/brand\/(app-icon|adaptive-foreground|splash)\.png$/.test(path))) return false;
  if (path.startsWith('apps/mobile/src/website/')) return platform === 'web';
  if (path.startsWith('apps/mobile/scripts/')) return platform === 'web';
  return path.startsWith('apps/mobile/src/') || path.startsWith('apps/mobile/assets/') || ['apps/mobile/index.ts', 'apps/mobile/app.json', 'apps/mobile/app.config.js', 'apps/mobile/metro.config.js', 'apps/mobile/babel.config.js', 'apps/mobile/tsconfig.json', 'apps/mobile/release-metadata.cjs'].includes(path);
}

/** Calculate a target's input identity at a Git revision, including only its installed dependency graph. */
export function sourceInputs(ref: string, target: 'server' | 'android' | 'ios', cwd = root): string {
  const tree = new Map(git(['ls-tree', '-r', '-z', ref], cwd).split('\0').filter(Boolean).map(line => {
    const split = line.indexOf('\t'); return [line.slice(split + 1), line.slice(0, split).split(' ').at(-1)!];
  }));
  const paths = [...tree.keys()];
  const all = new Set(paths);
  const read = (path: string) => JSON.parse(git(['show', `${ref}:${path}`], cwd));
  const lock = read('package-lock.json');
  const excluded = new Set<string>();
  if (target !== 'server') {
    const sources = paths.filter(p => relevantFile(p, target, all) && /\.[cm]?[jt]sx?$/.test(p));
    // Expo's web peers and the PWA-only database/tooling do not participate in native resolution.
    // If app/shared native code starts referencing one, conservatively include its whole graph again.
    for (const name of ['idb', 'react-dom', 'react-native-web', 'workbox-build']) {
      const result = sources.length ? spawnSync('git', ['grep', '-l', '-F', ...[`'${name}'`, `"${name}"`, `'${name}/`, `"${name}/`].flatMap(p => ['-e', p]), ref, '--', ...sources], { cwd, encoding: 'utf8', windowsHide: true }) : { status: 1 };
      assert(result.status === 0 || result.status === 1, 'Cannot resolve platform dependency usage.');
      if (result.status === 1) excluded.add(name);
    }
  }
  const mobile = dependencyClosure(lock, 'apps/mobile', target === 'server' ? ['workbox-build', '@expo/cli'] : ['@expo/cli'], excluded);
  const server = target === 'server' ? dependencyClosure(lock, 'apps/server', ['tsup', 'typescript']) : undefined;
  const workspaces = new Set(Object.keys({ ...mobile, ...server }).filter(p => p.startsWith('packages/')));
  const files = paths.filter(p => relevantFile(p, target, all) && (!p.startsWith('packages/') || workspaces.has(p.split('/').slice(0, 2).join('/')))).map(path => [path,
    path.endsWith('.json') ? hash(withoutVersions(path, read(path))) : tree.get(path)]);
  // Root scripts affect Docker builds; unrelated test/development scripts do not ship.
  const scripts = read('package.json').scripts || {};
  const native = target === 'server' ? withoutVersions('native-release.json', read('native-release.json')) : undefined;
  const manifests = ['apps/mobile/package.json', ...[...workspaces].map(p => `${p}/package.json`), ...(target === 'server' ? ['apps/server/package.json'] : [])].filter(p => all.has(p)).map(path => {
    const doc = read(path);
    return [path, Object.fromEntries(['name', 'main', 'module', 'exports', 'type', 'sideEffects', 'react-native', 'browser'].map(k => [k, doc[k]])),
      target === 'server' ? { build: doc.scripts?.build, web: doc.scripts?.['build:web'], start: doc.scripts?.start } : undefined];
  });
  return hash({ files, mobile, server, native, manifests, build: target === 'server' ? scripts.build : undefined });
}
