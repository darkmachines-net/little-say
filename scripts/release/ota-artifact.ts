/** @file Retains exact OTA exports before provider intent and restores their original bytes after runner loss. */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createArtifactManifest, validateArtifactPath, verifyArtifactManifest } from '../../tools/release-engine/index.mjs';
import { assert, sha256 } from './common';
import { downloadAsset, type Journal } from './journal';

/** Return the verified export directory before any EAS request; restoration uses fresh storage and never writes through the prior destination. */
export async function retainExport(journal: Journal, key: string, directory: string, exportOnce: () => void): Promise<string> {
  assert(/^(android|ios)-[a-z0-9.-]+$/.test(key), 'Invalid export identity.');
  const name = `export.${key}.bin`;
  const descriptor = `export.${key}.json`;
  const archiveFile = resolve(mkdtempSync(resolve(tmpdir(), 'little-say-export-')), name);
  const existing = journal.release()?.assets.find((asset: any) => asset.name === name);
  if (existing) {
    downloadAsset(journal.release(), name, archiveFile);
    const contents = JSON.parse(gunzipSync(readFileSync(archiveFile), { maxOutputLength: 512 * 1024 * 1024 }).toString('utf8'));
    assert(contents.schema === 1 && Array.isArray(contents.files) && contents.files.length === contents.manifest.files.length, 'Invalid retained export.');
    const restored = resolve(dirname(archiveFile), 'contents'); mkdirSync(restored);
    for (const file of contents.files) {
      assert(typeof file.path === 'string' && typeof file.bytes === 'string', 'Invalid retained file.');
      validateArtifactPath(file.path);
      const destination = resolve(restored, file.path), rel = relative(restored, destination);
      assert(rel && !rel.startsWith('..') && !isAbsolute(rel) && !file.path.includes('\\'), 'Retained export escapes its directory.');
      assert(contents.manifest.files.some((entry: any) => entry.path === file.path), 'Unexpected retained file.');
      mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, Buffer.from(file.bytes, 'base64'));
    }
    await verifyArtifactManifest(restored, contents.manifest);
    journal.put(descriptor, { schema: 1, archive: name, sha256: sha256(archiveFile), manifest: contents.manifest });
    return restored;
  }
  assert(!journal.read(descriptor) && !journal.operation(`ota-${key}`), 'An OTA request exists without its original export. Reconcile rather than recompiling.');
  exportOnce();
  const manifest = await createArtifactManifest(directory);
  const files = manifest.files.map(file => ({ path: file.path, bytes: readFileSync(resolve(directory, file.path)).toString('base64') }));
  const serialized = Buffer.from(JSON.stringify({ schema: 1, manifest, files }));
  assert(serialized.length <= 512 * 1024 * 1024, 'Export archive exceeds the recoverable size limit.');
  writeFileSync(archiveFile, gzipSync(serialized));
  await verifyArtifactManifest(directory, manifest);
  journal.putArchive(name, archiveFile);
  journal.put(descriptor, { schema: 1, archive: name, sha256: sha256(archiveFile), manifest });
  return directory;
}
