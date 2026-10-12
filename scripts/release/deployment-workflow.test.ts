/** @file Verifies shared webhook workflow credentials and release gating across selected work, failures, and cancellation. */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { root } from './common';

const readWorkflow = (file: string) => parse(readFileSync(resolve(root, '.github/workflows', file), 'utf8'));
const cut = readWorkflow('cut-release.yml');
const deployment = readWorkflow('deploy-self-hosted.yml');
const secretNames = ['DEPLOY_WG_ENDPOINT', 'DEPLOY_WG_PRIVATE_KEY', 'DEPLOY_TOKEN'];
const variableNames = ['DEPLOY_HOST', 'DEPLOY_URL', 'DEPLOY_WG_ADDRESS', 'DEPLOY_WG_PUBLIC_KEY'];
type Result = 'success' | 'failure' | 'cancelled' | 'skipped';
type Needs = Record<string, { result: Result; outputs?: Record<string, string> }>;

function needsFor(server: boolean, ota: boolean, active = true): Needs {
  return {
    prepare: { result: 'success', outputs: { active: String(active), server: String(server), ota: String(ota) } },
    server: { result: server ? 'success' : 'skipped' },
    'promote-server': { result: server ? 'success' : 'skipped' },
    deploy: { result: server || ota ? 'success' : 'skipped' },
    native: { result: 'success' }, submit: { result: 'skipped' }, ota: { result: ota ? 'success' : 'skipped' },
  };
}

// Evaluate the checked-in, repository-owned boolean expression with only synthetic Actions contexts.
function enabled(job: string, needs: Needs, cancelled = false): boolean {
  const expression = cut.jobs[job].if.replace(/^\$\{\{\s*|\s*\}\}$/g, '').replace(/\bneeds\.([\w-]+)/g, 'needs["$1"]');
  return new Function('needs', 'always', 'cancelled', `return (${expression});`)(needs, () => true, () => cancelled);
}

describe('deployment before release OTA', () => {
  it('promotes the verified image before calling the reusable deployment with named credentials', () => {
    expect(cut.jobs['promote-server'].needs).toEqual(['prepare', 'server']);
    expect(cut.jobs['promote-server'].steps.at(-1).run).toBe('npm run release:cut -- promote-server');
    expect(cut.jobs.deploy.needs).toEqual(['prepare', 'server', 'promote-server']);
    expect(cut.jobs.deploy.uses).toBe('./.github/workflows/deploy-self-hosted.yml');
    expect(cut.jobs.deploy.permissions).toEqual({ contents: 'read' });
    expect(cut.jobs.deploy.secrets).toEqual(Object.fromEntries(secretNames.map(name => [name, '${{ secrets.' + name + ' }}'])));
    expect(cut.jobs.ota.needs).toContain('deploy');
    expect(cut.jobs.finalize.needs).toContain('deploy');
    expect(cut.jobs.finalize.permissions.packages).toBe('read');
    for (const name of ['deploy', 'ota', 'finalize']) {
      expect(cut.jobs[name].if).toContain('always()');
      expect(cut.jobs[name].if).toContain('!cancelled()');
      expect(cut.jobs[name].if).toContain("needs.prepare.result == 'success'");
    }
  });

  it.each([
    { name: 'server-only', server: true, ota: false, active: true, expected: [true, false, true] },
    { name: 'OTA-only with skipped server/promotion jobs', server: false, ota: true, active: true, expected: [true, true, true] },
    { name: 'server and OTA', server: true, ota: true, active: true, expected: [true, true, true] },
    { name: 'native-only', server: false, ota: false, active: true, expected: [false, false, true] },
    { name: 'no selected work', server: false, ota: false, active: false, expected: [false, false, false] },
  ])('preserves $name scheduling', ({ server, ota, active, expected }) => {
    const needs = needsFor(server, ota, active);
    expect(['deploy', 'ota', 'finalize'].map(job => enabled(job, needs))).toEqual(expected);
  });

  it.each(['prepare', 'server', 'promote-server'])('blocks downstream deployment, OTA, and completion after %s failure', failed => {
    const needs = needsFor(true, true);
    needs[failed].result = 'failure'; needs.deploy.result = 'skipped'; needs.ota.result = 'skipped';
    expect(['deploy', 'ota', 'finalize'].map(job => enabled(job, needs))).toEqual([false, false, false]);
  });

  it.each(['failure', 'cancelled', 'skipped'] as const)('blocks OTA and required release completion when deployment is %s', result => {
    for (const server of [true, false]) {
      const needs = needsFor(server, true); needs.deploy.result = result; needs.ota.result = 'skipped';
      expect(enabled('ota', needs)).toBe(false); expect(enabled('finalize', needs)).toBe(false);
    }
    const serverOnly = needsFor(true, false); serverOnly.deploy.result = result;
    expect(enabled('finalize', serverOnly)).toBe(false);
  });

  it('retains native failure and cancellation boundaries after successful deployment', () => {
    const needs = needsFor(true, true); needs.native.result = 'failure';
    expect(enabled('ota', needs)).toBe(false); expect(enabled('finalize', needs)).toBe(false);
    expect(['deploy', 'ota', 'finalize'].map(job => enabled(job, needsFor(true, true), true))).toEqual([false, false, false]);
  });
});

describe('restricted shared webhook deployment', () => {
  it('uses manual/reusable entry points, a bounded hosted runner, and serialized protected environment', () => {
    expect(Object.keys(deployment.on)).toEqual(['workflow_dispatch', 'workflow_call']);
    expect(deployment['run-name']).toBe('Deploy little-say server (${{ inputs.request_id || github.run_id }})');
    expect(deployment.on.workflow_dispatch.inputs.request_id).toMatchObject({ type: 'string', required: false });
    expect(deployment.on.workflow_call.secrets).toEqual(Object.fromEntries(secretNames.map(name => [name, { required: true }])));
    expect(deployment.permissions).toEqual({ contents: 'read' });
    expect(deployment.env).toBeUndefined();
    expect(Object.keys(deployment.jobs)).toEqual(['deploy']);
    const job = deployment.jobs.deploy;
    expect(job['runs-on']).toBe('ubuntu-latest');
    expect(job['timeout-minutes']).toBe(20);
    expect(job.environment).toBe('self-hosted-testing');
    expect(job.concurrency).toEqual({ group: 'little-say-self-hosted-deploy', 'cancel-in-progress': false });
    expect(job.env).toBeUndefined();
    expect(job.permissions).toBeUndefined();
  });

  it('checks the default branch before checkout and passes secrets only to the fixed connector', () => {
    const steps = deployment.jobs.deploy.steps;
    expect(steps[0].env).toEqual({ DEFAULT_BRANCH: '${{ github.event.repository.default_branch }}' });
    expect(steps[0].run).toContain('test "$GITHUB_REF" = "refs/heads/$DEFAULT_BRANCH"');
    const checkout = steps.find((step: any) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout.with).toEqual({ ref: '${{ github.workflow_sha }}', 'persist-credentials': false });
    for (const step of steps) if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
    const sensitive = steps.filter((step: any) => JSON.stringify(step).includes('secrets.'));
    expect(sensitive).toHaveLength(1);
    expect(sensitive[0].run).toBe('node deploy/scripts/connect-and-deploy.mjs');
    expect(sensitive[0].env).toEqual({
      ...Object.fromEntries(variableNames.map(name => [name, '${{ vars.' + name + ' }}'])),
      ...Object.fromEntries(secretNames.map(name => [name, '${{ secrets.' + name + ' }}'])),
    });
    expect(JSON.stringify(deployment)).not.toMatch(/secrets: inherit|EXPO_TOKEN|GH_TOKEN|OPENAI_API_KEY|docker login|DEPLOY_SSH_|self-hosted-deploy\.mjs/);
    expect(JSON.stringify(cut.jobs.deploy)).not.toMatch(/DEPLOY_SSH_|secrets: inherit/);
  });

  it('removes the fixed tunnel even after failure or cancellation', () => {
    const cleanup = deployment.jobs.deploy.steps.at(-1);
    expect(cleanup.if).toBe('always()');
    expect(cleanup.run).toContain('sudo ip link show little-say-ci');
    expect(cleanup.run).toContain('sudo ip link delete little-say-ci');
    expect(cleanup.env).toBeUndefined();
  });
});
