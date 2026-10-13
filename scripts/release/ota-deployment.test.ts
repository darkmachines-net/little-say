/** @file Verifies local OTA dispatch correlation, deployment failure/timeout handling, and publication ordering. */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { root } from './common';
import { deployServerBeforeOta } from './ota-deployment';

const requestId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const selectedRun = {
  databaseId: 42,
  displayTitle: `Deploy little-say server (${requestId})`,
  event: 'workflow_dispatch', headBranch: 'master', status: 'completed', conclusion: 'success',
  url: 'https://github.com/owner/little-say/actions/runs/42',
};

function fixture({ lists = [[selectedRun]], views = [selectedRun], repository = 'owner/little-say', branch = 'master', dispatchFailure = false } = {}) {
  let clock = 0;
  const calls: { command: string; args: string[] }[] = [];
  const logs: string[] = [];
  const delays: number[] = [];
  let listIndex = 0;
  let viewIndex = 0;
  const io = {
    run(command: string, args: string[]) {
      calls.push({ command, args });
      if (command === 'git') return 'git@github.com:owner/little-say.git';
      if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: repository, defaultBranchRef: { name: branch } });
      if (args[0] === 'workflow') {
        if (dispatchFailure) throw new Error('Dispatch denied');
        return '';
      }
      if (args[1] === 'list') return JSON.stringify(lists[Math.min(listIndex++, lists.length - 1)]);
      if (args[1] === 'view') return JSON.stringify(views[Math.min(viewIndex++, views.length - 1)]);
      throw new Error('Unexpected command');
    },
    sleep: async (milliseconds: number) => { delays.push(milliseconds); clock += milliseconds; },
    now: () => clock,
    requestId: () => requestId,
    log: (message: string) => { logs.push(message); },
  };
  return { io, calls, logs, delays };
}

describe('local OTA server deployment gate', () => {
  it('dispatches the default branch and ignores unrelated successful runs until its exact request succeeds', async () => {
    const other = { ...selectedRun, databaseId: 41, displayTitle: 'Deploy little-say server (other-request)' };
    const queued = { ...selectedRun, status: 'queued', conclusion: '' };
    const running = { ...queued, status: 'in_progress' };
    const f = fixture({ lists: [[other], [other, queued]], views: [running, selectedRun] });
    await deployServerBeforeOta(f.io);
    const dispatch = f.calls.find(call => call.args[0] === 'workflow');
    expect(dispatch?.args).toEqual(['workflow', 'run', 'deploy-self-hosted.yml', '--ref', 'master', '--raw-field', `request_id=${requestId}`, '--repo', 'owner/little-say']);
    const polling = f.calls.filter(call => call.args[0] === 'run');
    expect(polling.map(call => call.args[1])).toEqual(['list', 'list', 'view', 'view']);
    expect(polling.filter(call => call.args[1] === 'view').every(call => call.args[2] === '42')).toBe(true);
    expect(f.delays).toEqual([5000, 5000, 5000]);
    expect(f.logs.at(-1)).toContain('health check succeeded');
  });

  it.each(['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', ''])('blocks publication when deployment concludes %s', async conclusion => {
    const f = fixture({ lists: [[{ ...selectedRun, conclusion }]] });
    await expect(deployServerBeforeOta(f.io)).rejects.toThrow('no OTA was published');
    expect(f.logs.some(message => message.includes('health check succeeded'))).toBe(false);
  });

  it('does not silently retry an uncertain or rejected dispatch', async () => {
    const f = fixture({ dispatchFailure: true });
    await expect(deployServerBeforeOta(f.io)).rejects.toThrow('Dispatch denied');
    expect(f.calls.filter(call => call.args[0] === 'workflow')).toHaveLength(1);
    expect(f.calls.some(call => call.args[0] === 'run')).toBe(false);
  });

  it('rejects a GitHub CLI repository selection that differs from origin before dispatch', async () => {
    const f = fixture({ repository: 'unrelated/little-say' });
    await expect(deployServerBeforeOta(f.io)).rejects.toThrow('different repository');
    expect(f.calls.some(call => call.args[0] === 'workflow')).toBe(false);
  });

  it('uses the resolved default branch and rejects an unexpected branch/event in the matching run', async () => {
    const good = fixture({ branch: 'main', lists: [[{ ...selectedRun, headBranch: 'main' }]] });
    await deployServerBeforeOta(good.io);
    expect(good.calls.find(call => call.args[0] === 'workflow')?.args).toContain('main');
    for (const override of [{ headBranch: 'feature' }, { event: 'pull_request' }]) {
      const bad = fixture({ lists: [[{ ...selectedRun, ...override }]] });
      await expect(deployServerBeforeOta(bad.io)).rejects.toThrow('identity differs');
    }
  });

  it('rejects duplicate request identities and changes to a previously selected run', async () => {
    const duplicate = fixture({ lists: [[selectedRun, { ...selectedRun, databaseId: 43 }]] });
    await expect(deployServerBeforeOta(duplicate.io)).rejects.toThrow('Multiple deployment runs');
    const changed = fixture({ lists: [[{ ...selectedRun, status: 'queued', conclusion: '' }]], views: [{ ...selectedRun, databaseId: 99 }] });
    await expect(deployServerBeforeOta(changed.io)).rejects.toThrow('different deployment run');
  });

  it.each([true, false])('bounds both run discovery and queued deployment waits (discoverable=%s)', async discoverable => {
    const queued = { ...selectedRun, status: 'queued', conclusion: '' };
    const f = fixture({ lists: [discoverable ? [queued] : []], views: [queued] });
    await expect(deployServerBeforeOta(f.io)).rejects.toThrow('Timed out waiting');
    expect(f.delays.reduce((total, delay) => total + delay, 0)).toBe(40 * 60 * 1000);
    expect(f.calls.filter(call => call.args[0] === 'workflow')).toHaveLength(1);
  });

  it('keeps local OTA free of deployment and rechecks source, environment, and channel before publishing', () => {
    const native = readFileSync(resolve(root, 'scripts/release/native.ts'), 'utf8');
    const ota = native.slice(native.indexOf("assert(command === 'ota'"));
    const dryRun = ota.indexOf("if (args['dry-run'])");
    const publish = ota.indexOf("eas(['update'");
    expect(dryRun).toBeGreaterThan(0);
    expect(ota).not.toContain('deployServerBeforeOta');
    expect(ota.slice(dryRun, publish)).toContain('return;');
    expect(publish).toBeGreaterThan(dryRun);
    const rechecks = ota.slice(dryRun, publish);
    expect(rechecks).toContain('requireSameSource(commit)');
    expect(rechecks).toContain('remoteEnvironment(profile)');
    expect(rechecks).toContain('channelBranch(profile)');
  });
});
