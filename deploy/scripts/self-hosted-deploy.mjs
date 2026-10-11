/** @file Upgrades the host-configured little-say Compose service and verifies Docker and API health. */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCKER_TIMEOUT_MS = 10 * 60 * 1000;
const HEALTH_PROBE = `
  const response = await fetch('http://127.0.0.1:8787/api/ready', {
    cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || (await response.json())?.status !== 'ok') {
    throw new Error('Application health check did not succeed.');
  }
`;

function dockerCommand(args, cwd) {
  return execFileSync('docker', args, {
    cwd, encoding: 'utf8', timeout: DOCKER_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  }).trim();
}

function validateConfig(config) {
  if (!config || typeof config.projectDirectory !== 'string' || !path.isAbsolute(config.projectDirectory)) {
    throw new Error('projectDirectory must be an absolute host path.');
  }
  if (typeof config.projectName !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(config.projectName)) {
    throw new Error('Set the existing Compose projectName.');
  }
  if (!Array.isArray(config.composeFiles) || config.composeFiles.length === 0) throw new Error('Set composeFiles.');
  for (const file of [...config.composeFiles, config.envFile]) {
    if (typeof file !== 'string' || !file || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
      throw new Error('Compose and environment files must be paths inside projectDirectory.');
    }
    let isFile = false;
    try { isFile = fs.statSync(path.join(config.projectDirectory, file)).isFile(); } catch { /* Report only the configuration problem. */ }
    if (!isFile) throw new Error('Missing stack file.');
  }
  if (!Number.isSafeInteger(config.waitTimeoutSeconds) || config.waitTimeoutSeconds <= 0 || config.waitTimeoutSeconds > 480) {
    throw new Error('waitTimeoutSeconds must be an integer from 1 to 480.');
  }
}

/**
 * Pull and upgrade only little-say using the existing host stack, then require Docker and API health.
 * The configured files are read without modification; failed upgrades leave diagnosis and recovery
 * to the operator. Docker failures omit captured output because it can contain host secrets.
 * @param {object} config Root-owned Compose paths, project name, and health wait timeout in seconds.
 * @param {object} options Optional Docker executor and progress logger for offline validation.
 */
export function deploy(config, { runDocker = dockerCommand, log = console.log } = {}) {
  validateConfig(config);
  const docker = (args) => {
    try { return runDocker(args, config.projectDirectory); } catch {
      throw new Error(`Docker ${args[0]} failed; inspect the stack locally with docker compose ps/logs.`);
    }
  };
  const compose = (args) => docker([
    'compose', '--project-name', config.projectName, '--project-directory', config.projectDirectory,
    '--env-file', path.join(config.projectDirectory, config.envFile),
    ...config.composeFiles.flatMap((file) => ['-f', path.join(config.projectDirectory, file)]), ...args,
  ]);

  log('Pulling the configured little-say image.');
  compose(['pull', '--policy', 'always', 'little-say']);
  log('Upgrading little-say and waiting for its health check.');
  compose(['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait',
    '--wait-timeout', String(config.waitTimeoutSeconds), 'little-say']);

  const id = compose(['ps', '--all', '--quiet', 'little-say']);
  if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Expected exactly one little-say container after deployment.');
  // Compose --wait also accepts services without health checks; require affirmative health.
  if (docker(['inspect', '--format', '{{.State.Health.Status}}', id]) !== 'healthy') {
    throw new Error('Little-say health check did not succeed.');
  }
  docker(['exec', id, 'node', '--input-type=module', '-e', HEALTH_PROBE]);
  log('Deployment and application health check succeeded.');
}

function main() {
  if (process.getuid?.() !== 0) throw new Error('Run through the installed root-owned deployment wrapper.');
  if (process.argv.length !== 2) throw new Error('No command-line arguments are accepted.');
  let config;
  try { config = JSON.parse(fs.readFileSync('/etc/little-say/deploy.json', 'utf8')); } catch {
    throw new Error('Could not read the root-owned deployment configuration.');
  }
  deploy(config);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(`[deploy] ${error.message}`);
    process.exitCode = 1;
  }
}
