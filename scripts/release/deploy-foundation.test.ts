/** @file Verifies database migration failures, external database selection, readiness failures, and compatible-only rollback ordering. */
import { expect, it, vi } from 'vitest';
import { deployImage } from './deploy';

it.each(['migration', 'readiness', 'incompatible'] as const)('preserves the database when deployment fails at %s', async stage => {
  const calls: { args: string[]; image: string }[] = [];
  let replaced = false;
  const run = (_command: string, args: string[], options: any) => {
    calls.push({ args, image: options.env?.LITTLE_SAY_SERVER_IMAGE });
    if (args.includes('compose') && args.includes('ps')) return replaced ? 'new-container' : 'old-container';
    if (args.includes('image') && args.includes('inspect')) return JSON.stringify([{ Id: 'new-image', Config: { Labels: { 'org.opencontainers.image.version': '0.1.1', 'org.opencontainers.image.revision': 'a'.repeat(40) } } }]);
    if (args.includes('inspect')) return JSON.stringify([args.includes('old-container') ? { Image: 'old-image' } : { Image: 'new-image', State: { Health: { Status: 'healthy' } } }]);
    if (args.includes('migrate') && stage === 'migration') throw new Error('migration failed');
    if (args.includes('status') && stage === 'incompatible') throw new Error('incompatible');
    if (args.includes('up') && args.at(-1) === 'little-say') replaced = true;
    return '';
  };
  const fetcher = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify({ status: String(url).endsWith('/ready') ? 'unavailable' : 'ok', version: '0.1.1' }))) as unknown as typeof fetch;
  await expect(deployImage({ context: 'test-host', project: 'test-project', image: 'ghcr.io/org/app', serverUrl: 'https://example.invalid', envFile: 'absent-test.env', database: 'external' },
    'ghcr.io/org/app@sha256:' + 'a'.repeat(64), '0.1.1', { run, fetch: fetcher, receipt: 'unused-receipt.json' })).rejects.toThrow();
  expect(calls.some(call => call.args.some(arg => arg.endsWith('compose.postgres.yaml')))).toBe(false);
  const replacements = calls.filter(call => call.args.includes('up'));
  expect(replacements).toHaveLength(stage === 'migration' ? 0 : stage === 'readiness' ? 2 : 1);
  if (stage === 'readiness') {
    expect(replacements[1].image).toBe('old-image');
    expect(calls.findIndex(call => call.args.includes('status'))).toBeLessThan(calls.indexOf(replacements[1]));
  }
  expect(calls.some(call => call.args.includes('down') || call.args.includes('--volumes'))).toBe(false);
});
