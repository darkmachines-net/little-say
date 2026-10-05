/**
 * @file Configures and deploys published server digests to a local Docker context with health
 * verification and rollback.
 */

import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { isAbsolute, resolve } from 'node:path';
import { assert, fail, machineRoot, parseArgs, readJson, root, run, safeEnvironment, writeJson } from './common';

export interface Deployment { context: string; image: string; serverUrl: string; envFile: string; project: string; database?: 'compose' | 'external'; }
const file = resolve(machineRoot, 'server.json');
/**
 * Reject unsafe or incomplete Docker target settings, server origins, and environment files inside the
 * checkout.
 */
export function validateDeployment(config: Deployment) {
  assert(config.database === undefined || ['compose', 'external'].includes(config.database), 'Database must be compose or external.');
  assert(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(config.context), 'Choose an existing Docker context name.');
  assert(/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(config.image), 'Use ghcr.io/owner/repository without a tag.');
  assert(/^[a-z0-9][a-z0-9_-]*$/.test(config.project), 'Invalid Compose project name.');
  const url = new URL(config.serverUrl);
  assert(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Use a server origin without credentials or paths.');
  assert(isAbsolute(config.envFile) && existsSync(config.envFile), 'Provide an existing absolute --env-file outside the repository.');
  const path = config.envFile.replaceAll('\\', '/').toLowerCase();
  assert(!path.startsWith(`${root.replaceAll('\\', '/').toLowerCase()}/`), 'Keep the deployment environment file outside the checkout.');
}
/** Combine an image repository with a validated SHA-256 digest; mutable tags are not accepted. */
export function immutableImage(image: string, digest: string) {
  assert(/^sha256:[a-f0-9]{64}$/.test(digest), 'Pass --digest sha256:<64 hex characters> from the GitHub publication summary. Tags are not deployment inputs.');
  return `${image}@${digest}`;
}
async function main() {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3), ['context', 'image', 'server-url', 'env-file', 'project', 'database', 'digest', 'version', 'dry-run', 'help']);
  if (args.help) { console.log('server:configure --context CONTEXT --image ghcr.io/owner/repo --server-url https://HOST --env-file /external/server.env [--project little-say]\nserver:deploy --digest sha256:... --version 0.1.1 [--dry-run]'); return; }
  if (command === 'configure') {
    const config: Deployment = { context: args.context, image: args.image, serverUrl: args['server-url']?.replace(/\/+$/, ''), envFile: args['env-file'], project: args.project || 'little-say', database: (args.database || 'compose') as 'compose' | 'external' };
    validateDeployment(config);
    run('docker', ['context', 'inspect', config.context], { capture: true });
    writeJson(file, config); console.log(`Saved local deployment target in ${file}.`); return;
  }
  assert(command === 'deploy' && existsSync(file), 'Run server:configure first.');
  const config = readJson<Deployment>(file); validateDeployment(config);
  const image = immutableImage(config.image, args.digest || '');
  assert(/^\d+\.\d+\.\d+$/.test(args.version || ''), 'Provide --version from the publication summary.');
  if (args['dry-run']) { console.log(`Would deploy ${image}\nDocker context: ${config.context}\nCompose project: ${config.project}\nExpected health: ${config.serverUrl}/api/health, version ${args.version}\nEnvironment: ${config.envFile}\nSpeech cache: ${config.project}_speech-cache (preserved)`); return; }
  await deployImage(config, image, args.version);
}
/**
 * Pull and deploy an image, verify its labels and public health, and write a receipt. On deployment
 * failure, attempt to restore the previous image while preserving the speech cache.
 */
export async function deployImage(config: Deployment, image: string, version: string, io = { run, fetch, receipt: resolve(machineRoot, 'last-server-deployment.json') }) {
  const docker = (params: string[], capture = false, env = safeEnvironment()) => io.run('docker', ['--context', config.context, ...params], { capture, env });
  const settings = existsSync(config.envFile) ? parse(readFileSync(config.envFile)) : {};
  const database = config.database ?? 'compose';
  const overlays = [...(database === 'compose' ? ['--file', resolve(root, 'compose.postgres.yaml')] : []), ...(settings.GOOGLE_APPLICATION_CREDENTIALS ? ['--file', resolve(root, 'compose.firebase-credentials.yaml')] : [])];
  const compose = (params: string[], selectedImage: string, capture = false) => docker(['compose', '--project-name', config.project, '--file', resolve(root, 'deploy/compose.yaml'), ...overlays, '--env-file', config.envFile, ...params], capture, { ...safeEnvironment(), LITTLE_SAY_SERVER_IMAGE: selectedImage, LITTLE_SAY_SERVER_ENV_FILE: config.envFile });
  const current = compose(['ps', '--all', '--quiet', 'little-say'], image, true);
  assert(!current.includes('\n'), 'More than one service container found. Refusing an ambiguous deployment.');
  const previous = current ? JSON.parse(docker(['inspect', current], true))[0] : null;
  docker(['pull', image]);
  const target = JSON.parse(docker(['image', 'inspect', image], true))[0];
  assert(target.Config?.Labels?.['org.opencontainers.image.version'] === version && /^[a-f0-9]{40}$/.test(target.Config?.Labels?.['org.opencontainers.image.revision'] || ''), 'Published image labels do not match the requested release.');
  let replacementStarted = false;
  try {
    if (database === 'compose') compose(['up', '--detach', '--pull', 'missing', '--wait', '--wait-timeout', '120', 'postgres'], image);
    compose(['run', '--rm', '--no-deps', '--pull', 'never', 'little-say', 'node', 'server/database-cli.js', 'migrate'], image);
    replacementStarted = true;
    compose(['up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '120', 'little-say'], image);
    const id = compose(['ps', '--quiet', 'little-say'], image, true);
    const running = JSON.parse(docker(['inspect', id], true))[0];
    assert(running.Image === target.Id && running.State?.Health?.Status === 'healthy', 'Running container differs from the requested healthy image.');
    const response = await io.fetch(`${config.serverUrl}/api/health`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
    const health = await response.json() as { status?: string; version?: string };
    assert(response.ok && health.status === 'ok' && health.version === version, 'Public health endpoint did not confirm the release.');
    const readiness = await io.fetch(`${config.serverUrl}/api/ready`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
    const ready = await readiness.json() as { status?: string; version?: string };
    assert(readiness.ok && ready.status === 'ok' && ready.version === version, 'Public database readiness did not confirm the release.');
    writeJson(io.receipt, { image, version, revision: target.Config.Labels['org.opencontainers.image.revision'], context: config.context, project: config.project, previousImage: previous?.Image, completedAt: new Date().toISOString() });
    console.log(`Deployed and verified server ${version}: ${image}`);
  } catch (error) {
    if (previous?.Image && replacementStarted) {
      try {
        compose(['run', '--rm', '--no-deps', '--pull', 'never', 'little-say', 'node', 'server/database-cli.js', 'status'], previous.Image);
        compose(['up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '120', 'little-say'], previous.Image);
        console.error('Deployment failed; restored the previous compatible image. Database and caches were preserved.');
      } catch { console.error('Previous image is incompatible or rollback failed. Database migrations were not reversed and volumes were preserved.'); }
    } else console.error('Deployment stopped. No database migrations were reversed; database and cache volumes were preserved.');
    throw error;
  }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/release/deploy.ts')) main().catch(fail);
