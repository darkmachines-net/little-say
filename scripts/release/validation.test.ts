/** @file Exercises the real release validator and subprocess runner against a controlled npm CLI, without release side effects. */
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
  writeFileSync(cli, `const fs = require('node:fs');
fs.appendFileSync(process.env.VALIDATION_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
const script = process.argv[3];
if (script === 'check' && process.env.VALIDATION_FAILURE === 'check') process.exit(11);
if (script === 'test:services') {
  if (process.env.VALIDATION_FAILURE === 'startup') process.exit(12);
  if (process.env.VALIDATION_FAILURE === 'tests') process.exit(13);
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
        env: { ...environment, npm_execpath: cli, VALIDATION_LOG: log, VALIDATION_FAILURE: failure },
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

it('isolates manual branch validation from every release job and credential', () => {
  const workflow = parse(readFileSync(join(root, '.github/workflows/cut-release.yml'), 'utf8'));
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  expect(workflow.on.workflow_dispatch.inputs.validation_only).toMatchObject({ type: 'boolean', default: false });
  expect(workflow.env.GH_TOKEN).toBeUndefined();
  expect(JSON.stringify(workflow.env)).not.toMatch(/secrets\.|github\.token/);
  const job = workflow.jobs.validate;
  expect(job.if).toBe('inputs.validation_only');
  expect(job.permissions).toEqual({ contents: 'read' });
  expect(job.needs).toBeUndefined();
  expect(job.steps.map((step: any) => step.run).filter(Boolean)).toEqual(['npm ci', 'npm run release:validate']);
  expect(job.steps[0].with).toEqual({ ref: '${{ github.sha }}', 'persist-credentials': false });
  expect(JSON.stringify(job)).not.toMatch(/secrets\.|github\.token|release:cut|docker\/login|eas-cli/);
  expect(job.services.postgres.image).toBe('postgres:17-bookworm');
  expect(Object.keys(workflow.jobs).sort()).toEqual(['finalize', 'native', 'ota', 'prepare', 'server', 'submit', 'validate']);
  for (const name of ['prepare', 'server', 'native', 'submit', 'ota', 'finalize']) {
    expect(workflow.jobs[name].if).toMatch(/^\$\{\{ !inputs\.validation_only && /);
    expect(workflow.jobs[name].env.GH_TOKEN).toBe('${{ github.token }}');
  }
  expect(workflow.jobs.prepare.if).toContain("github.ref == format('refs/heads/{0}', github.event.repository.default_branch)");
});
