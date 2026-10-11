/** @file Verifies release summaries distinguish planned work, exclusions, retained versions, and verified artifact links. */

import { expect, it } from 'vitest';
import { planRelease } from './planner';
import { releaseSummary } from './summary';
import type { NativeBuildBaseline } from './contract';

const release = { version: '0.1.0', androidVersionCode: 1, iosBuildNumber: '1', expoOwner: 'test', expoProjectId: 'project', serverUrl: 'https://test.invalid' };
const plan = planRelease({ runId: '123', source: 'a'.repeat(40), profile: 'internal', bump: 'minor', inputs: { server: 's', native: { android: 'a', ios: 'i' }, bundle: { android: 'ab', ios: 'ib' }, environmentHash: 'env' }, serverVersion: '0.2.0', nativeRelease: release });

it('shows selected versions and runtime decisions without claiming publication', () => {
  const text = releaseSummary(plan);
  expect(text).toContain('| Server image | Selected | 0.3.0 | changed inputs or missing verified image |');
  expect(text).toContain('| android build | Selected | 0.2.0 (build 2) |');
  expect(text).toContain('| ios OTA | Selected | 0.2.0 |');
  expect(text).not.toContain('Published'); expect(text).not.toContain('https://expo.dev');
});

it('retains existing platform versions and explains excluded OTA targets', () => {
  const existing = { platform: 'ios', profile: 'internal', release } as NativeBuildBaseline;
  const unchanged = { ...plan, server: false, native: [], baselines: [existing], otaTargets: [{ platform: 'ios' as const, runtimeVersion: '0.1.0', eligible: false, reason: 'retired by committed policy' }] };
  const text = releaseSummary(unchanged);
  expect(text).toContain('| ios build | Skipped | 0.1.0 (build 1) |');
  expect(text).toContain('| ios OTA | Skipped |'); expect(text).toContain('retired by committed policy');
  expect(text).toContain('no supported compatible runtime');
});

it('links verified image, native build and OTA results without changing the recorded plan', () => {
  const before = structuredClone(plan);
  const text = releaseSummary(plan, {
    server: { commit: plan.source, version: plan.serverVersion, image: 'ghcr.io/test/app', digest: 'sha256:abc', input: 's' },
    baselines: [{ platform: 'android', profile: 'internal', release: plan.nativeRelease, buildId: 'exact-build', submissionId: 'exact-submission' } as NativeBuildBaseline],
    ota: [{ commit: plan.source, platform: 'android', runtimeVersion: '0.2.0', group: 'exact-update', input: 'ab', payloadHash: 'hash' }], skipped: ['ios: no supported compatible runtime'],
  });
  expect(text).toContain('https://github.com/test/app/pkgs/container/app');
  expect(text).toContain('ghcr.io/test/app@sha256:abc');
  expect(text).toContain('https://expo.dev/accounts/test/projects/little-say/builds/exact-build');
  expect(text).toContain('Submission `exact-submission`');
  expect(text).toContain('https://expo.dev/accounts/test/projects/little-say/updates/exact-update');
  expect(text).toContain('| android OTA | Published | 0.2.0 |'); expect(text).toContain('| ios OTA | Skipped |');
  expect(plan).toEqual(before);
});

it('identifies unchanged OTA groups reused during a combined runtime publication', () => {
  const previous = { commit: plan.source, platform: 'android' as const, runtimeVersion: '0.1.0', group: 'existing-group', input: 'ab', payloadHash: 'hash' };
  const retained = { ...plan, previousOta: [previous] };
  const results = { baselines: [], ota: [previous], skipped: [] };
  expect(releaseSummary(retained, results)).toContain('| android OTA | Reused | 0.1.0 |');
  results.ota.push({ ...previous, runtimeVersion: '0.2.0', group: 'new-group' });
  expect(releaseSummary(retained, results)).toContain('| android OTA | Published / reused | 0.1.0, 0.2.0 |');
});
