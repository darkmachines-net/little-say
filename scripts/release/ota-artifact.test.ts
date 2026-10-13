/** @file Verifies original OTA bytes survive lost archive/descriptor responses and partial publication without re-export. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadAsset, type Journal } from './journal';
import { retainExport } from './ota-artifact';
import { hash } from './inputs';

vi.mock('./journal', () => ({ downloadAsset: vi.fn() }));
let temporary: string[], assets: Map<string, Buffer>, documents: Map<string, unknown>, operation: unknown, journal: Journal;
beforeEach(() => {
  temporary = []; assets = new Map(); documents = new Map(); operation = undefined; vi.resetAllMocks();
  journal = {
    release: () => ({ assets: [...assets.keys()].map(name => ({ name })) }),
    read: (name: string) => documents.get(name),
    operation: () => operation,
    put: (name: string, value: unknown) => { if (documents.has(name)) expect(hash(value)).toBe(hash(documents.get(name))); else documents.set(name, value); },
    putArchive: (name: string, file: string) => { assets.set(name, readFileSync(file)); },
  } as unknown as Journal;
  vi.mocked(downloadAsset).mockImplementation((_release, name, destination) => { writeFileSync(destination, assets.get(name)!); return 'digest'; });
});
afterEach(() => { for (const directory of temporary) rmSync(directory, { recursive: true, force: true }); });
function directory() { const value = mkdtempSync(resolve(tmpdir(), 'ota-retain-test-')); temporary.push(value); return value; }
function exportTo(destination: string) { mkdirSync(resolve(destination, 'bundles')); writeFileSync(resolve(destination, 'bundles/index.hbc'), 'Hermes temporary path /tmp/original'); writeFileSync(resolve(destination, 'metadata.json'), '{}'); }

it('restores exact bytes after a lost descriptor response and records no second export', async () => {
  const original = directory(); const exportOnce = vi.fn(() => exportTo(original));
  const put = journal.put; journal.put = () => { throw Error('lost descriptor upload response'); };
  await expect(retainExport(journal, 'android-1.2.3', original, exportOnce)).rejects.toThrow('lost descriptor');
  expect(assets.size).toBe(1); journal.put = put;
  const restored = await retainExport(journal, 'android-1.2.3', directory(), exportOnce); temporary.push(restored);
  expect(exportOnce).toHaveBeenCalledOnce(); expect(readFileSync(resolve(restored, 'bundles/index.hbc'), 'utf8')).toContain('/tmp/original');
  expect(documents.size).toBe(1);
});

it('retains an accepted operation payload across runner loss and rejects altered descriptors', async () => {
  const original = directory(); await retainExport(journal, 'ios-1.2.3', original, () => exportTo(original));
  operation = { status: 'running', ids: ['accepted-group'] };
  const exporter = vi.fn(() => { throw Error('must not recompile'); });
  await retainExport(journal, 'ios-1.2.3', directory(), exporter); expect(exporter).not.toHaveBeenCalled();
  documents.set('export.ios-1.2.3.json', { changed: true });
  await expect(retainExport(journal, 'ios-1.2.3', directory(), exporter)).rejects.toThrow();
});

it('does not regenerate a missing original archive after a provider request', async () => {
  operation = { status: 'intent', ids: [] }; const exporter = vi.fn();
  await expect(retainExport(journal, 'ios-1.2.3', directory(), exporter)).rejects.toThrow('without its original export');
  expect(exporter).not.toHaveBeenCalled();
});

it('rejects damaged archives instead of exporting replacement bytes', async () => {
  assets.set('export.android-1.2.3.bin', Buffer.from('corrupt')); const exporter = vi.fn();
  await expect(retainExport(journal, 'android-1.2.3', directory(), exporter)).rejects.toThrow(); expect(exporter).not.toHaveBeenCalled();
});

it('restores into fresh storage without writing through an existing destination junction', async () => {
  const original = directory(); await retainExport(journal, 'android-1.2.3', original, () => exportTo(original));
  const outside = directory(); writeFileSync(resolve(outside, 'index.hbc'), 'outside sentinel');
  const destination = directory(); symlinkSync(outside, resolve(destination, 'bundles'), 'junction');
  const restored = await retainExport(journal, 'android-1.2.3', destination, () => { throw Error('must not export'); }); temporary.push(restored);
  expect(readFileSync(resolve(outside, 'index.hbc'), 'utf8')).toBe('outside sentinel');
  expect(readFileSync(resolve(restored, 'bundles/index.hbc'), 'utf8')).toContain('/tmp/original');
});
