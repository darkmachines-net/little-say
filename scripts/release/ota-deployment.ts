/** @file Gates local OTA publication on a uniquely correlated GitHub server deployment and health check. */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { assert, root, safeEnvironment } from './common';

const workflow = 'deploy-self-hosted.yml';
const waitLimitMs = 40 * 60 * 1000;
const pollIntervalMs = 5000;
const runFields = 'databaseId,displayTitle,event,headBranch,status,conclusion,url';

interface DeploymentRun {
  databaseId: number;
  displayTitle: string;
  event: string;
  headBranch: string;
  status: string;
  conclusion: string;
  url: string;
}

interface DeploymentIo {
  /** Execute a bounded Git/GitHub CLI command in this checkout and return stdout. */
  run(command: string, args: string[]): string;
  /** Delay the next status request by the supplied milliseconds. */
  sleep(milliseconds: number): Promise<unknown>;
  /** Return milliseconds from a clock used to bound the overall wait. */
  now(): number;
  /** Allocate a unique workflow request identifier for this invocation. */
  requestId(): string;
  /** Show deployment progress without exposing deployment credentials. */
  log(message: string): void;
}

const defaultIo: DeploymentIo = {
  run(command, args) {
    const env = safeEnvironment();
    // Resolve the checkout's repository instead of accepting a shell-wide gh repository override.
    delete env.GH_REPO;
    delete env.GH_HOST;
    try {
      return execFileSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
    } catch {
      throw new Error(`${command} failed during the OTA deployment gate. Check GitHub CLI authentication and Actions access; no OTA was published.`);
    }
  },
  sleep: setTimeout,
  now: Date.now,
  requestId: randomUUID,
  log: console.log,
};

/**
 * Dispatch the default-branch server deployment through the authenticated GitHub CLI, then require
 * success from that exact request before returning. Poll for at most 40 minutes, including queue
 * time; failed, skipped, cancelled, ambiguous, or unobservable runs block OTA publication. Deployment
 * credentials remain in GitHub's protected environment and are never downloaded to this machine.
 */
export async function deployServerBeforeOta(io: DeploymentIo = defaultIo): Promise<void> {
  const origin = io.run('git', ['remote', 'get-url', 'origin']);
  const expectedRepository = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+?)\/?$/.exec(origin.replace(/\.git\/?$/, ''))?.[1];
  assert(expectedRepository, 'The OTA deployment gate requires a github.com origin remote.');
  const repository = JSON.parse(io.run('gh', ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef']));
  assert(typeof repository.nameWithOwner === 'string' && repository.nameWithOwner.toLowerCase() === expectedRepository.toLowerCase(), 'GitHub CLI selected a different repository from origin. Fix the local GitHub repository selection before publishing.');
  const branch = repository.defaultBranchRef?.name;
  assert(typeof branch === 'string' && branch.length > 0, 'Cannot resolve the repository default branch for server deployment.');
  const requestId = io.requestId();
  assert(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId), 'Invalid deployment request identifier.');
  const title = `Deploy little-say server (${requestId})`;
  const repoArgs = ['--repo', repository.nameWithOwner];
  const deadline = io.now() + waitLimitMs;
  io.log('Deploying the server through GitHub Actions before publishing OTA.');
  io.run('gh', ['workflow', 'run', workflow, '--ref', branch, '--raw-field', `request_id=${requestId}`, ...repoArgs]);
  let selected: DeploymentRun | undefined;
  while (io.now() < deadline) {
    let current: DeploymentRun | undefined;
    if (selected) {
      current = JSON.parse(io.run('gh', ['run', 'view', String(selected.databaseId), '--json', runFields, ...repoArgs]));
      assert(current?.databaseId === selected.databaseId, 'GitHub returned a different deployment run; no OTA was published.');
    } else {
      const runs: DeploymentRun[] = JSON.parse(io.run('gh', ['run', 'list', '--workflow', workflow, '--branch', branch, '--event', 'workflow_dispatch', '--limit', '100', '--json', runFields, ...repoArgs]));
      assert(Array.isArray(runs), 'Cannot read deployment workflow runs; no OTA was published.');
      const matches = runs.filter(run => run.displayTitle === title);
      assert(matches.length <= 1, 'Multiple deployment runs match this request; no OTA was published.');
      current = matches[0];
    }
    if (current) {
      assert(current.displayTitle === title && current.event === 'workflow_dispatch' && current.headBranch === branch && Number.isSafeInteger(current.databaseId) && current.databaseId > 0, 'Deployment run identity differs from the dispatched request; no OTA was published.');
      if (!selected) io.log(`Waiting for server deployment: ${current.url}`);
      selected = current;
      if (current.status === 'completed') {
        assert(current.conclusion === 'success', `Server deployment ended with ${current.conclusion || 'no conclusion'}; no OTA was published. Inspect ${current.url}`);
        io.log('Server deployment and application health check succeeded.');
        return;
      }
    }
    const remaining = deadline - io.now();
    if (remaining > 0) await io.sleep(Math.min(pollIntervalMs, remaining));
  }
  throw new Error(`Timed out waiting for server deployment; no OTA was published. The deployment may still be running. Inspect ${selected?.url || 'the Deploy self-hosted server workflow in GitHub Actions'}.`);
}
