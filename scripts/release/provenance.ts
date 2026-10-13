/** @file Seals release decisions with distinct application, workflow, and shared-engine revisions and validates their selected stage graph. */
import { resolve } from 'node:path';
import { buildReleaseGraph, createPlan, hashIdentity, verifyPlan, type ReadonlyJsonValue, type ReleaseStage } from '../../tools/release-engine/index.mjs';
import { assert, readJson, root } from './common';
import { requiresDeployment, type ReleasePlan } from './contract';

/** Describe selected execution prerequisites, keeping store acceptance separate from store completion. */
export function selectedStages(plan: ReleasePlan) {
  const stages: ReleaseStage[] = [];
  if (plan.server) stages.push({ id: 'server', component: 'server' }, { id: 'promote-server', component: 'server', needs: ['server'] });
  if (requiresDeployment(plan)) stages.push({ id: 'deploy', component: 'server', needs: plan.server ? ['promote-server'] : [] });
  for (const platform of plan.native) stages.push({ id: `native.${platform}`, component: `native.${platform}` });
  for (const platform of plan.submissions) {
    stages.push({ id: `submit.${platform}`, component: `native.${platform}`, needs: [`native.${platform}`, ...(requiresDeployment(plan) ? ['deploy'] : [])] });
    stages.push({ id: `submit-complete.${platform}`, component: `native.${platform}`, needs: [`submit.${platform}`] });
  }
  if (plan.ota.length) stages.push({ id: 'ota', component: 'ota', needs: [...(requiresDeployment(plan) ? ['deploy'] : []), ...plan.native.map(p => `native.${p}`), ...plan.submissions.map(p => `${plan.schema === 1 ? 'submit-complete' : 'submit'}.${p}`)] });
  if (stages.length) stages.push({ id: 'finalize', component: 'release', needs: stages.map(stage => stage.id) });
  return buildReleaseGraph(stages);
}

function snapshot(plan: ReleasePlan): ReadonlyJsonValue {
  const { engine: _engine, ...decision } = plan;
  return JSON.parse(JSON.stringify(decision));
}

/** Seal new plan provenance after destinations/runtimes are fixed; workflow revision is supplied independently of the version-prepared checkout. */
export function sealReleasePlan(plan: ReleasePlan, repository: string, workflowCommit: string): void {
  assert(plan.schema === 2, 'Only new plans acquire an engine envelope.');
  const toolkitCommit = readJson(resolve(root, 'release-engine.lock.json')).revision;
  plan.engine = createPlan({ source: { repository, commit: plan.source, workflowCommit, toolkitCommit }, graph: selectedStages(plan), decisionsDigest: hashIdentity(snapshot(plan)) });
}

/** Verify immutable modern decisions and their actual pinned toolkit/workflow; historical plans retain their existing validation. */
export function verifyReleasePlan(plan: ReleasePlan, repository: string, workflowCommit: string): void {
  if (plan.schema === 1) return;
  assert(plan.engine, 'Modern release plan is missing shared-engine provenance.');
  const toolkitCommit = readJson(resolve(root, 'release-engine.lock.json')).revision;
  verifyPlan(plan.engine, { repository, commit: plan.source, workflowCommit, toolkitCommit });
  assert(plan.engine.decisionsDigest === hashIdentity(snapshot(plan)) && hashIdentity(plan.engine.graph) === hashIdentity(selectedStages(plan)), 'Shared release envelope differs from its immutable decisions.');
}
