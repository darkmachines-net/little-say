/** @file Publishes immutable multi-architecture images and verifies source/version labels before reuse or promotion. */

import { spawnSync } from 'node:child_process';
import { assert, git, readJson, root, run } from './common';
import { resolve } from 'node:path';
import type { ReleasePlan, ServerReceipt } from './contract';
import { Journal } from './journal';
import { sourceInputs } from './inputs';

/** Return an image digest, distinguishing a missing tag from authentication/network failures. */
export function imageDigest(reference: string): string | undefined {
  const result = spawnSync('docker', ['buildx', 'imagetools', 'inspect', reference], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    assert(!result.error && /manifest unknown|not found/i.test(result.stderr) && !/unauthorized|denied/i.test(result.stderr), 'Cannot read GHCR. Verify registry access before retrying.');
    return undefined;
  }
  const digest = /^Digest:\s+(sha256:[a-f0-9]{64})/m.exec(result.stdout)?.[1];
  assert(digest, 'Registry response has no digest.'); return digest;
}

/** Verify both architectures and immutable OCI labels, returning the exact published digest. */
export function verifyImage(image: string, version: string, commit: string): string | undefined {
  const versionDigest = imageDigest(`${image}:v${version}`);
  const shaDigest = imageDigest(`${image}:sha-${commit}`);
  if (!versionDigest && !shaDigest) return undefined;
  assert(!versionDigest || !shaDigest || versionDigest === shaDigest, 'Immutable image tags conflict.');
  const digest = versionDigest || shaDigest!;
  const manifest = JSON.parse(run('docker', ['buildx', 'imagetools', 'inspect', `${image}@${digest}`, '--raw'], { capture: true }));
  for (const architecture of ['amd64', 'arm64']) {
    const child = manifest.manifests?.find((m: any) => m.platform?.os === 'linux' && m.platform?.architecture === architecture);
    assert(child, `Published image lacks linux/${architecture}.`);
    const reference = `${image}@${child.digest}`;
    run('docker', ['pull', '--platform', `linux/${architecture}`, reference], { capture: true });
    const labels = JSON.parse(run('docker', ['image', 'inspect', '--format', '{{json .Config.Labels}}', reference], { capture: true }));
    assert(labels['org.opencontainers.image.revision'] === commit && labels['org.opencontainers.image.version'] === version && labels['org.opencontainers.image.source']?.toLowerCase() === `https://github.com/${process.env.GITHUB_REPOSITORY}`.toLowerCase(), 'Image source/version labels conflict.');
  }
  return digest;
}

/** Bootstrap only from an ancestor stable server tag whose image is actually available and verified. */
export function legacyImage(image: string, source: string): ServerReceipt | undefined {
  const tags = git(['tag', '--merged', source, '--sort=-version:refname']).split(/\r?\n/).filter(t => /^v\d+\.\d+\.\d+$/.test(t));
  for (const tag of tags) {
    const commit = git(['rev-parse', `${tag}^{commit}`]);
    const version = tag.slice(1);
    const digest = verifyImage(image, version, commit);
    if (digest) return { image, commit, version, digest, input: sourceInputs(commit, 'server') };
  }
  return undefined;
}

/** Create or reconcile the plan's image without rebuilding over immutable version or revision tags. */
export function publishImage(plan: ReleasePlan, commit: string, journal: Journal): ServerReceipt {
  const image = `ghcr.io/${process.env.GITHUB_REPOSITORY!.toLowerCase()}`;
  const previous = journal.operation<ServerReceipt>('server')?.result;
  const tag = `v${plan.serverVersion}`;
  const existingTag = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  if (existingTag) {
    const refs = existingTag.split(/\r?\n/).map(line => line.split(/\s+/));
    assert((refs.find(([, name]) => name.endsWith('^{}')) || refs[0])[0] === commit, 'Server Git tag points at another commit.');
  } else {
    git(['tag', tag, commit]); git(['push', 'origin', `refs/tags/${tag}`]);
  }
  journal.save({ key: 'server', status: 'running', ids: [commit], result: previous });
  const existing = verifyImage(image, plan.serverVersion, commit);
  assert(!previous || previous.commit === commit && previous.version === plan.serverVersion && previous.digest === existing, 'Previously verified immutable image changed or disappeared.');
  if (!existing) {
    run('docker', ['buildx', 'build', '--platform', 'linux/amd64,linux/arm64', '--push',
      '--tag', `${image}:${tag}`, '--tag', `${image}:sha-${commit}`,
      '--label', `org.opencontainers.image.source=https://github.com/${process.env.GITHUB_REPOSITORY}`,
      '--label', `org.opencontainers.image.revision=${commit}`, '--label', `org.opencontainers.image.version=${plan.serverVersion}`,
      '.']);
  }
  const digest = verifyImage(image, plan.serverVersion, commit);
  assert(digest, 'Image publication did not produce a verified digest.');
  for (const name of [tag, `sha-${commit}`]) if (!imageDigest(`${image}:${name}`)) run('docker', ['buildx', 'imagetools', 'create', '--tag', `${image}:${name}`, `${image}@${digest}`]);
  const receipt = { image, commit, version: plan.serverVersion, digest, input: plan.inputs.server };
  journal.save({ key: 'server', status: 'complete', ids: [commit], result: receipt }); return receipt;
}

/** Advance latest only after the full cut succeeds and only if no newer server version has been prepared. */
export function promoteImage(receipt: ServerReceipt): void {
  const version = JSON.parse(git(['show', `origin/${process.env.DEFAULT_BRANCH}:release.json`])).version;
  assert(version === receipt.version && readJson(resolve(root, 'release.json')).version === receipt.version, 'A newer server version exists; refusing stale latest promotion.');
  assert(verifyImage(receipt.image, receipt.version, receipt.commit) === receipt.digest, 'Final image readback changed.');
  run('docker', ['buildx', 'imagetools', 'create', '--tag', `${receipt.image}:latest`, `${receipt.image}@${receipt.digest}`]);
  assert(imageDigest(`${receipt.image}:latest`) === receipt.digest, 'Latest image readback failed.');
}
