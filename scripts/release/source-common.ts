/** @file Small application-hook I/O helpers; release authorization, persistence and provider operations belong to the shared package. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const mobile = resolve(root, 'apps/mobile');
/** Fail an application-specific assertion before returning evidence to the shared runner. */
export function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
/** Read application metadata; the caller validates the expected fields. */
export function readJson<T = any>(file: string): T { return JSON.parse(readFileSync(file, 'utf8')); }
/** Write generated local artifacts without changing release-ledger state. */
export function writeJson(file: string, value: unknown) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); }
/** Hash one retained local build file. */
export function sha256(file: string) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
/** Retain portable toolchain settings while excluding authentication and executable environment overrides. */
export function sourceEnvironment(values: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|XDG_CONFIG_HOME|XDG_CACHE_HOME|TMP|TEMP|TMPDIR|SHELL|TERM|LANG|LANGUAGE|TZ|CI|NODE_ENV|FORCE_COLOR|NO_COLOR|JAVA_HOME|ANDROID_HOME|ANDROID_SDK_ROOT|DEVELOPER_DIR|SDKROOT|NPM_EXECPATH|NPM_NODE_EXECPATH|NPM_CONFIG_CACHE|EXPO_NO_DOTENV|LITTLE_SAY_CHANNEL|LITTLE_SAY_OTA_VERSIONS|LITTLE_SAY_FINGERPRINT_PLATFORM|LITTLE_SAY_GOOGLE_IOS_URL_SCHEME|TEST_PGHOST|TEST_PGPORT|TEST_PGDATABASE|TEST_PGUSER|TEST_PGPASSWORD|TEST_PGSSLMODE|FIREBASE_AUTH_EMULATOR_HOST|GCLOUD_PROJECT|LC_[A-Z_]+)$/i;
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => allowed.test(key) && typeof value === 'string'));
}
/** Run a source tool without a shell; keep logs on stderr so hook stdout remains one JSON document. */
export function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean; input?: string } = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd || root, env: options.env || sourceEnvironment(), encoding: 'utf8',
    input: options.input, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.stderr) process.stderr.write(result.stderr);
  if (!options.capture && result.stdout) process.stderr.write(result.stdout);
  assert(!result.error && result.status === 0, `${command} failed (exit ${result.status}).`);
  return (result.stdout || '').trim();
}
/** Execute application tooling with this process's Node runtime. */
export function node(script: string, args: string[], options: Parameters<typeof run>[2] = {}) { return run(process.execPath, [script, ...args], options); }
/** Use npm's executable on POSIX; invoke its Node script directly on Windows without a command shell. */
export function npm(args: string[], options: Parameters<typeof run>[2] = {}) {
  if (process.env.npm_execpath) return node(process.env.npm_execpath, args, options);
  return process.platform === 'win32' ? node(resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), args, options) : run('npm', args, options);
}
/** Read committed application inputs from Git. */
export function git(args: string[], cwd = root) { return run('git', ['--no-replace-objects', ...args], { cwd, capture: true }); }
