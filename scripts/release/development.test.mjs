/** @file Verifies automatic beta release routing, separate Dev/promotion environments, manual previews and immutable toolkit pins. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';

const root = new URL('../../', import.meta.url);
const workflow = YAML.parse(fs.readFileSync(new URL('.github/workflows/release.yml', root), 'utf8'));
const development = YAML.parse(fs.readFileSync(new URL('.github/workflows/development.yml', root), 'utf8'));
const config = JSON.parse(fs.readFileSync(new URL('release.config.json', root), 'utf8'));

/** Evaluate this caller's GitHub input routing for automatic and manual invocations. */
function resolve(expression, inputs = {}) {
  return new Function('inputs', 'fromJSON', `return (${expression.slice(3, -2)});`)(inputs, JSON.parse);
}

test('master pushes enter the shared release workflow with beta and no forced rebuild', () => {
  assert.deepEqual(workflow.on.push.branches, ['master']);
  assert.equal(workflow.on.pull_request, undefined);
  assert.equal(resolve(workflow.jobs.release.with.profile), 'beta');
  assert.equal(resolve(workflow.jobs.release.with.rebuild), false);
  assert.equal(workflow.concurrency, undefined, 'Pending promotion must not block new Dev candidates.');
  assert.equal(config.development.channel, 'development');
  assert.equal(config.development.promotionEnvironment, 'beta');
  assert.notEqual(config.development.approvalEnvironment, config.development.promotionEnvironment);
  assert.deepEqual(config.development.platforms, ['android', 'ios']);
  assert.ok(Object.values(config.profiles).every(profile => profile.channel !== config.development.channel));
});

test('manual release destinations and explicit rebuilds remain available', () => {
  assert.equal(workflow.on.workflow_dispatch.inputs.destination.default, 'production');
  for (const [destination, profile] of [['production', 'beta'], ['public-stores', 'production']]) {
    assert.equal(resolve(workflow.jobs.release.with.profile, { destination }), profile);
    for (const rebuild of [true, false]) assert.equal(resolve(workflow.jobs.release.with.rebuild, { rebuild }), rebuild);
  }
  assert.equal(development.on.push, undefined, 'Automatic preparation belongs to Release.');
  assert.deepEqual(development.on.workflow_dispatch.inputs.operation.options, ['build', 'update']);
  assert.equal(development.jobs.development.with.channel, undefined, 'Manual previews remain isolated.');
});

test('development, release, package and lock use the same immutable toolkit revision', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(new URL('package-lock.json', root), 'utf8'));
  const pin = pkg.devDependencies['@mchartier/expo-release'].split('#')[1];
  assert.match(pin, /^[a-f0-9]{40}$/);
  for (const [name, job] of [['development', development.jobs.development], ['release', workflow.jobs.release]]) {
    assert.equal(job.uses, `darkmachines-net/expo-release-template/.github/workflows/${name}.yml@${pin}`);
  }
  assert.ok(lock.packages['node_modules/@mchartier/expo-release'].resolved.endsWith('#' + pin));
});
