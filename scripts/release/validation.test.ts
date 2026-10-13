/** @file Exercises the shared source validator and keeps standalone Check CI independent of release credentials and publication. */
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { parse } from 'yaml';
import { root } from './common';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

// A real child process substitutes only the external npm CLI. candidate/common are not mocked:
// this catches command selection and failure propagation through their actual spawnSync boundary.
async function validate(failure: string) {
  const directory = mkdtempSync(join(tmpdir(), 'release-validation-')); directories.push(directory);
  const cli = join(directory, 'npm.cjs'), log = join(directory, 'commands.jsonl');
  writeFileSync(cli, `/** @file Records validation commands and simulates a requested subprocess failure. */
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');
const script = process.argv[3];
const failure = ${JSON.stringify(failure)};
if (script === 'check' && failure === 'check') process.exit(11);
if (script === 'test:services') {
  if (failure === 'startup') process.exit(12);
  if (failure === 'tests') process.exit(13);
}
`);
  // Windows treats environment names case-insensitively; remove npm's inherited spelling
  // before selecting the fixture so this regression cannot recursively launch real checks.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_execpath'));
  // File-backed output avoids nested synchronous pipe inheritance on Windows.
  const output = join(directory, 'output.log'), descriptor = openSync(output, 'w');
  let status: number | null;
  try {
    status = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/release/validation.ts'], {
        cwd: root, stdio: ['ignore', descriptor, descriptor], timeout: 15000, windowsHide: true,
        env: { ...environment, npm_execpath: cli },
      });
      child.once('error', reject);
      child.once('close', resolve);
    });
  } finally { closeSync(descriptor); }
  return { status, stderr: readFileSync(output, 'utf8'), commands: readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) };
}

it('runs checks then the maintained emulator wrapper, never bare integration', async () => {
  const result = await validate('');
  expect(result.status, result.stderr).toBe(0);
  expect(result.commands).toEqual([['run', 'check'], ['run', 'test:services']]);
  // Bind the selected package script to the demo-only wrapper and the complete integration suite.
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
  expect(scripts['test:services']).toBe('firebase emulators:exec --only auth --project demo-little-say "npm run test:integration"');
});

it.each([['check', 11], ['startup', 12], ['tests', 13]])('fails closed for %s failure through the command runner', async (failure, status) => {
  const result = await validate(String(failure));
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(`failed (exit ${status})`);
  expect(result.commands).toEqual(failure === 'check' ? [['run', 'check']] : [['run', 'check'], ['run', 'test:services']]);
});

it('keeps manual branch validation in Check without release access', () => {
  const workflow = parse(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'));
  expect(Object.keys(workflow.on)).toContain('workflow_dispatch');
  expect(workflow.permissions).toEqual({ contents: 'read' });
  const job = workflow.jobs.check;
  expect(job.services.postgres.image).toBe('postgres:17-bookworm');
  expect(job.steps.map((step: any) => step.run)).toEqual(expect.arrayContaining(['npm run check', 'npm run test:services']));
  expect(JSON.stringify(workflow)).not.toMatch(/secrets\.|EXPO_TOKEN|release:cut|docker\/login|eas-cli/);
});
