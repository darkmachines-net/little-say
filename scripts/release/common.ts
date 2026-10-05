/** @file Shares filesystem, subprocess, argument, and environment helpers across local release commands. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const mobile = resolve(root, 'apps/mobile');
export const machineRoot = resolve(process.env.LOCALAPPDATA || process.env.XDG_CONFIG_HOME || resolve(homedir(), '.config'), 'little-say');
/** Synchronously parse a JSON file; callers remain responsible for validating its runtime shape. */
export function readJson<T = any>(file: string): T { return JSON.parse(readFileSync(file, 'utf8')); }
/**
 * Create parent directories and write formatted JSON, requesting owner-only permissions for newly
 * created files.
 */
export function writeJson(file: string, data: unknown) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 }); }
/** Compute the SHA-256 digest of the file bytes for retained artifact verification. */
export function sha256(file: string) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
/** Throw the supplied message when the condition fails and narrow it for subsequent TypeScript code. */
export function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
/**
 * Run a hidden synchronous subprocess in the selected checkout, optionally capturing trimmed stdout;
 * throw on launch or nonzero exit.
 */
export function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean; input?: string } = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd || root, env: options.env || process.env, encoding: 'utf8', stdio: options.capture ? 'pipe' : [options.input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'], input: options.input, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed${result.error ? `: ${result.error.message}` : ` (exit ${result.status})`}.`);
  return (result.stdout || '').trim();
}
/** Run a script with the current Node executable using the shared subprocess options. */
export function node(script: string, args: string[], options: Parameters<typeof run>[2] = {}) { return run(process.execPath, [script, ...args], options); }
export const npmCli = process.env.npm_execpath || resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
/** Invoke the installed npm CLI through Node for consistent behavior across Windows and POSIX hosts. */
export function npm(args: string[], options: Parameters<typeof run>[2] = {}) { assert(existsSync(npmCli), 'Run this command through npm.'); return node(npmCli, args, options); }
/** Run Git in the selected checkout and return trimmed stdout, failing on a nonzero exit. */
export function git(args: string[], cwd = root) { return run('git', args, { cwd, capture: true }); }
/** Return the full HEAD SHA only when the checkout has no tracked changes or untracked source files. */
export function cleanCommit(cwd = root) {
  let commit: string;
  try { commit = git(['rev-parse', 'HEAD'], cwd); }
  catch { throw new Error('A committed checkout is required. Create the initial commit before running release commands.'); }
  assert(/^[a-f0-9]{40}$/.test(commit), 'A committed checkout is required.');
  assert(!git(['status', '--porcelain', '--untracked-files=all'], cwd), 'Commit or stash changes before releasing. Untracked source files count as changes.');
  return commit;
}
/**
 * Parse allowlisted long options and values, treating bare flags as true strings and rejecting
 * duplicates or unknown names.
 */
export function parseArgs(args: string[], allowed: string[]) {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i].replace(/^--/, '');
    assert(args[i].startsWith('--') && allowed.includes(name) && !(name in values), `Unknown or duplicate option: ${args[i]}`);
    values[name] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
  }
  return values;
}
/**
 * Copy the process environment without OpenAI keys or inherited Expo public, build, channel, dotenv,
 * and Node option overrides.
 */
export function safeEnvironment(source: NodeJS.ProcessEnv = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !/^(AAC_OPENAI_KEY|OPENAI_API_KEY|CHATGPT_.*|PG.*|DATABASE_.*|FIREBASE_.*|GOOGLE_APPLICATION_CREDENTIALS|EXPO_PUBLIC_.*|LITTLE_SAY_CHANNEL|NODE_OPTIONS|EAS_BUILD_.*|EXPO_NO_DOTENV)$/i.test(key)));
}
/** Check whether the module URL corresponds to the script invoked by Node. */
export function isMain(url: string) { return process.argv[1] && resolve(fileURLToPath(url)) === resolve(process.argv[1]); }
/** Report a command error and set a failing exit code without terminating the process immediately. */
export function fail(error: unknown) { console.error(error instanceof Error ? error.message : 'Release command failed.'); process.exitCode = 1; }
