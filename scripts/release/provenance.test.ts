/** @file Verifies immutable distinct release provenance and the native acceptance/OTA/store completion stage contract. */
import { beforeEach, expect, it, vi } from 'vitest';
import { readJson } from './common';
import { planRelease } from './planner';
import { sealReleasePlan, selectedStages, verifyReleasePlan } from './provenance';

vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), readJson: vi.fn() }));
const source = 'a'.repeat(40), workflow = 'b'.repeat(40), toolkit = 'c'.repeat(40);
function plan() {
  return planRelease({ runId: '123', source, profile: 'production', bump: 'patch', inputs: { server: 'server', native: { android: 'android', ios: 'ios' }, bundle: { android: 'bundle', ios: 'bundle' }, environmentHash: 'env' }, serverVersion: '1.0.0',
    nativeRelease: { version: '1.0.0', androidVersionCode: 1, iosBuildNumber: '1', expoOwner: 'owner', expoProjectId: 'project', serverUrl: 'https://example.invalid' }, resolveRuntime: () => 'f'.repeat(40) });
}
beforeEach(() => { vi.mocked(readJson).mockReturnValue({ revision: toolkit }); });

it('retains distinct application/workflow/toolkit revisions and rejects drift or changed decisions', () => {
  const release = plan(); sealReleasePlan(release, 'owner/app', workflow);
  expect(release.engine?.source).toEqual({ repository: 'owner/app', commit: source, workflowCommit: workflow, toolkitCommit: toolkit });
  expect(() => verifyReleasePlan(release, 'owner/app', workflow)).not.toThrow();
  expect(() => verifyReleasePlan(release, 'owner/app', source)).toThrow();
  release.ota = []; expect(() => verifyReleasePlan(release, 'owner/app', workflow)).toThrow('immutable decisions');
  const intact = plan(); sealReleasePlan(intact, 'owner/app', workflow); vi.mocked(readJson).mockReturnValue({ revision: 'd'.repeat(40) });
  expect(() => verifyReleasePlan(intact, 'owner/app', workflow)).toThrow();
});

it('gates OTA on verified builds and submission acceptance while finalization waits store completion', () => {
  const graph = selectedStages(plan());
  expect(graph.stages.find(stage => stage.id === 'ota')?.needs).toEqual(['deploy', 'native.android', 'native.ios', 'submit.android', 'submit.ios']);
  expect(graph.stages.find(stage => stage.id === 'finalize')?.needs).toContain('submit-complete.android');
  expect(graph.stages.find(stage => stage.id === 'submit.android')?.needs).toEqual(['deploy', 'native.android']);
});

it('does not add a modern envelope or new validation to historical saved plans', () => {
  const legacy = { ...plan(), schema: 1 as const };
  expect(() => verifyReleasePlan(legacy, 'owner/app', workflow)).not.toThrow();
  expect(selectedStages(legacy).stages.find(stage => stage.id === 'ota')?.needs).toContain('submit-complete.android');
});

it('does not select finalization for a no-op', () => {
  expect(selectedStages({ ...plan(), server: false, native: [], submissions: [], ota: [] }).stages).toEqual([]);
});
