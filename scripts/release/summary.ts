/** @file Renders release selection and verified component results without changing plans or provider state. */

import { platforms, type NativeBuildBaseline, type OtaReceipt, type ReleasePlan, type ServerReceipt } from './contract';

export interface ReleaseResults {
  server?: ServerReceipt;
  baselines: NativeBuildBaseline[];
  ota: OtaReceipt[];
  skipped: string[];
}

/** Format selected/skipped components, their versions and reasons; artifact links appear only from verified results. */
export function releaseSummary(plan: ReleasePlan, results?: ReleaseResults): string {
  const cell = (value: string) => value.replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
  const reason = (component: string) => plan.reasons.find(r => r.startsWith(`${component}: `))?.slice(component.length + 2) || 'See recorded plan';
  const status = (selected: boolean) => selected ? results ? 'Published' : 'Selected' : 'Skipped';
  const rows: string[][] = [];
  const image = results?.server;
  const imageRepository = image?.image.replace(/^ghcr\.io\//, '');
  rows.push(['Server image', status(plan.server), plan.serverVersion, reason('server'), image
    ? `[GHCR package](https://github.com/${imageRepository}/pkgs/container/${encodeURIComponent(imageRepository!.split('/').at(-1)!)}) · \`${image.image}@${image.digest}\`` : '—']);
  for (const platform of platforms) {
    const selected = plan.native.includes(platform);
    const baseline = (results?.baselines || plan.baselines).filter(b => b.platform === platform && b.profile === plan.profile).at(-1);
    const version = selected ? plan.nativeRelease.version : baseline?.release.version || '—';
    const buildNumber = selected ? platform === 'android' ? plan.nativeRelease.androidVersionCode : plan.nativeRelease.iosBuildNumber
      : baseline && (platform === 'android' ? baseline.release.androidVersionCode : baseline.release.iosBuildNumber);
    const project = baseline && `https://expo.dev/accounts/${encodeURIComponent(baseline.release.expoOwner)}/projects/little-say`;
    rows.push([`${platform} build`, status(selected), `${version}${buildNumber ? ` (build ${buildNumber})` : ''}`, reason(`${platform} build`),
      results && baseline ? `[EAS build](${project}/builds/${baseline.buildId})${baseline.submissionId ? ` · Submission \`${baseline.submissionId}\`` : ''}` : '—']);
    const targets = plan.otaTargets.filter(t => t.platform === platform && t.eligible);
    const updates = results?.ota.filter(o => o.platform === platform) || [];
    const exclusions = plan.otaTargets.filter(t => t.platform === platform && !t.eligible).map(t => `${t.runtimeVersion}: ${t.reason}`);
    const otaSelected = targets.length > 0;
    const details = [reason(`${platform} OTA`), ...exclusions, ...(results?.skipped.filter(s => s.startsWith(platform)) || [])];
    if (plan.ota.includes(platform) && !otaSelected) details.push('no supported compatible runtime');
    const reused = updates.filter(o => plan.previousOta.some(previous => previous.platform === o.platform && previous.runtimeVersion === o.runtimeVersion && previous.group === o.group)).length;
    const otaStatus = reused ? reused === updates.length ? 'Reused' : 'Published / reused' : status(results ? updates.length > 0 : otaSelected);
    rows.push([`${platform} OTA`, otaStatus,
      [...new Set((results ? updates.map(o => o.runtimeVersion) : targets.map(t => t.runtimeVersion)))].join(', ') || '—', details.join('; '),
      updates.map(o => `[${o.runtimeVersion}](https://expo.dev/accounts/${encodeURIComponent(plan.nativeRelease.expoOwner)}/projects/little-say/updates/${o.group})`).join(', ') || '—']);
  }
  return `Channel: **${plan.profile}**. Version increment: **${plan.bump}**. Planned source: \`${plan.source}\`.\n\n`
    + '| Component | Status | Version / runtime | Reason | Artifact |\n| --- | --- | --- | --- | --- |\n'
    + rows.map(row => `| ${row.map(cell).join(' | ')} |`).join('\n')
    + `\n\nStore submissions: ${reason('submit')}.`;
}
