import { appendFileSync } from 'node:fs';
import { assert, fail, git, run } from './common';
import { validateCommit } from './version';

try {
  const commit = process.env.RELEASE_COMMIT!;
  const base = process.env.DEFAULT_BRANCH!;
  assert(base && process.env.GITHUB_REF === `refs/heads/${base}`, 'Publish from a workflow running on the default branch.');
  const version = validateCommit(commit);
  git(['fetch', 'origin', `refs/heads/${base}:refs/remotes/origin/${base}`, '--tags']);
  git(['merge-base', '--is-ancestor', commit, `origin/${base}`]);
  assert(git(['rev-parse', 'HEAD']) === commit, 'Build checkout differs from the requested release commit.');
  const tag = `v${version}`;
  const existing = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  if (existing) {
    const refs = existing.split(/\r?\n/).map(line => line.split(/\s+/));
    const target = refs.find(([, ref]) => ref.endsWith('^{}'))?.[0] || refs[0][0];
    assert(target === commit, `${tag} already belongs to another commit.`);
  } else {
    git(['tag', tag, commit]); git(['push', 'origin', `refs/tags/${tag}`]);
  }
  const image = `ghcr.io/${process.env.GITHUB_REPOSITORY!.toLowerCase()}`;
  assert(/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(image), 'Invalid image repository.');
  // Only the newest prepared release may move latest; recovery of an older release cannot roll it back.
  const latestVersion = JSON.parse(git(['show', `origin/${base}:release.json`])).version;
  assert(process.env.GITHUB_OUTPUT, 'Missing workflow output file.');
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nimage=${image}\nlatest=${latestVersion === version}\n`);
  // Inspect immutable tags before deciding to build. Unexpected registry failures are fatal.
  const tags = [tag, `sha-${commit}`];
  const registry = (await import('node:child_process')).spawnSync;
  const found: { tag: string; digest: string }[] = [];
  for (const name of tags) {
    const result = registry('docker', ['buildx', 'imagetools', 'inspect', `${image}:${name}`], { encoding: 'utf8' });
    if (result.status === 0) {
      const digest = /^Digest:\s+(sha256:[a-f0-9]{64})/m.exec(result.stdout)?.[1];
      assert(digest, 'Registry response has no digest.'); found.push({ tag: name, digest });
    } else assert(/not found|manifest unknown/i.test(result.stderr) && !/unauthorized|denied/i.test(result.stderr), 'Cannot verify existing registry tags. Check GHCR access before retrying.');
  }
  if (found.length) {
    const digest = found[0].digest;
    assert(found.every(item => item.digest === digest), 'Immutable release tags disagree. Refusing to overwrite them.');
    run('docker', ['pull', '--platform', 'linux/amd64', `${image}@${digest}`]);
    const labels = JSON.parse(run('docker', ['image', 'inspect', '--format', '{{json .Config.Labels}}', `${image}@${digest}`], { capture: true }));
    assert(labels?.['org.opencontainers.image.revision'] === commit && labels?.['org.opencontainers.image.version'] === version, 'Existing image labels differ from the release commit/version. Refusing to reuse it.');
    // A version tag is protected by its Git tag; the SHA tag names the validated commit.
    // Recover partial publication without rebuilding or changing an existing immutable tag.
    for (const name of tags.filter(name => !found.some(item => item.tag === name))) run('docker', ['buildx', 'imagetools', 'create', '--tag', `${image}:${name}`, `${image}@${digest}`]);
    if (latestVersion === version) run('docker', ['buildx', 'imagetools', 'create', '--tag', `${image}:latest`, `${image}@${digest}`]);
    appendFileSync(process.env.GITHUB_OUTPUT, `exists=true\ndigest=${digest}\n`);
  } else appendFileSync(process.env.GITHUB_OUTPUT, 'exists=false\n');
} catch (error) { fail(error); }
