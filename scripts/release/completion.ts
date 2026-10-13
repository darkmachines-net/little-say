/** @file Publishes a verified release receipt and retains its complete candidate journal before removing the draft. */
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { assert, git, writeJson } from './common';
import { requiresDeployment, type NativeBuildBaseline, type PreparedRelease, type ReleasePlan, type ReleaseReceipt, type ServerReceipt } from './contract';
import { hash } from './inputs';
import { completedReceipts, downloadAsset, gh, Journal, readAsset, releases } from './journal';
import type { OtaResults } from './ota';
import { releaseSummary } from './summary';

/** Publish only after the caller verifies source, provider artifacts, deployment, and OTA proof; retries retain the identical receipt and journal. */
export function publishCompletion(plan: ReleasePlan, prepared: PreparedRelease, journal: Journal, baselines: NativeBuildBaseline[], ota: OtaResults | undefined, server: ServerReceipt | undefined): void {
  const receipt: ReleaseReceipt = journal.read<ReleaseReceipt>('receipt.json') || {
    schema: 1, runId: plan.runId, profile: plan.profile, commit: prepared.commit, completedAt: new Date().toISOString(), plan, prepared, server, baselines,
    ota: [...plan.previousOta.filter(old => !ota?.receipts.some(o => o.platform === old.platform && o.runtimeVersion === old.runtimeVersion)), ...(ota?.receipts || [])],
  };
  const expected = { ...receipt, plan, prepared, server, baselines, runId: plan.runId, profile: plan.profile, commit: prepared.commit,
    ota: [...plan.previousOta.filter(old => !ota?.receipts.some(o => o.platform === old.platform && o.runtimeVersion === old.runtimeVersion)), ...(ota?.receipts || [])] };
  assert(hash(expected) === hash(receipt), 'Completion receipt differs from verified results.');
  journal.put('receipt.json', receipt);
  const tag = `release/${plan.profile}/${plan.runId}`;
  const existingTag = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  if (existingTag) assert(existingTag.split(/\s/)[0] === prepared.commit, 'Completion tag conflicts.');
  else { git(['tag', tag, prepared.commit]); git(['push', 'origin', `refs/tags/${tag}`]); }
  const temp = mkdtempSync(resolve(tmpdir(), 'little-say-complete-'));
  const notes = resolve(temp, 'notes.md');
  const deployment = requiresDeployment(plan) ? 'The preceding workflow deployment upgraded the self-hosted testing Compose server and passed readiness checks. This receipt does not attest the deployed image digest.' : 'Server inputs were unchanged; this cut did not deploy the server.';
  const message = `Released ${plan.profile} from \`${prepared.commit}\`.\n\n${releaseSummary(plan, { server, baselines, ota: ota?.receipts || [], skipped: ota?.skipped || [] })}\n\n${deployment} Store processing/public rollout and device installation or OTA uptake have not been verified.\n`;
  writeFileSync(notes, message);
  let release = releases().find(r => r.tag_name === tag);
  if (!release) { gh(['release', 'create', tag, '--repo', process.env.GITHUB_REPOSITORY!, '--draft', '--verify-tag', '--title', `Little Say ${plan.profile} ${plan.runId}`, '--notes-file', notes]); release = releases().find(r => r.tag_name === tag); }
  const upload = (name: string, data: unknown) => {
    const existing = readAsset(release, name);
    if (existing) assert(hash(existing) === hash(data), `Completion ${name} conflicts.`);
    else { const file = resolve(temp, name); writeJson(file, data); gh(['release', 'upload', tag, file, '--repo', process.env.GITHUB_REPOSITORY!]); }
    release = releases().find(r => r.tag_name === tag);
    assert(hash(readAsset(release, name)) === hash(data), `Completion ${name} readback failed.`);
  };
  upload('receipt.json', receipt);
  const candidate = journal.release();
  assert(candidate?.draft, 'Candidate journal disappeared before archival.');
  for (const asset of candidate.assets.filter((asset: any) => asset.name.endsWith('.bin'))) {
    const file = resolve(temp, asset.name);
    downloadAsset(candidate, asset.name, file);
    const existing = release.assets?.find((item: any) => item.name === asset.name);
    if (!existing) gh(['release', 'upload', tag, file, '--repo', process.env.GITHUB_REPOSITORY!]);
    release = releases().find(r => r.tag_name === tag);
    assert(release.assets?.find((item: any) => item.name === asset.name)?.digest === asset.digest, 'Completed export archive differs.');
    downloadAsset(release, asset.name, resolve(mkdtempSync(resolve(tmpdir(), 'little-say-archive-check-')), asset.name));
  }
  const archive = { schema: 1, runId: plan.runId, releaseId: candidate.id, assets: candidate.assets.map((asset: any) => ({ id: asset.id, name: asset.name, digest: asset.digest, ...(asset.name.endsWith('.bin') ? { retainedAsset: asset.name } : { content: readAsset(candidate, asset.name) }) })).sort((a: any, b: any) => a.name.localeCompare(b.name)) };
  upload('journal.json', archive);
  gh(['release', 'edit', tag, '--repo', process.env.GITHUB_REPOSITORY!, '--draft=false', '--latest=false']);
  assert(completedReceipts().some(r => r.runId === plan.runId && hash(r) === hash(receipt)), 'Completed release is not readable.');
  gh(['release', 'delete', journal.tag, '--repo', process.env.GITHUB_REPOSITORY!, '--yes']);
  const output = `${message}\nRelease: https://github.com/${process.env.GITHUB_REPOSITORY}/releases/tag/${tag}`;
  console.log(output);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${output}\n\n`);
}
