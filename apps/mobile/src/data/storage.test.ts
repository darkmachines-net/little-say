/** @file Verifies native asset saves wait for asynchronous file writes, never index failed writes, and prune unreferenced speech assets. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pruneSpeech, savePictureAsset, saveSpeechAsset, writeSyncAsset } from './storage';

const native = vi.hoisted(() => ({ write: vi.fn(), run: vi.fn(), getAll: vi.fn(), deleteFile: vi.fn(), files: [] as { name: string }[], audio: vi.fn(), picture: vi.fn() }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({ execAsync: vi.fn(), runAsync: native.run, getAllAsync: native.getAll }) }));
vi.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///documents/' }));
vi.mock('expo-file-system', () => {
  class MockFile {
    exists = false; uri = 'file:///documents/asset'; write = native.write; name = '';
    /** Record the filename for directory-listing pruning assertions. */
    constructor(...parts: unknown[]) { const last = parts.at(-1); if (typeof last === 'string') this.name = last; }
    /** Forward file deletion to the hoisted spy with this file's name. */
    delete() { native.deleteFile(this.name); }
  }
  return {
    Paths: { document: 'file:///documents/' },
    Directory: class {
      exists = true;
      /** Pretend the fixture directory already exists without touching the real filesystem. */
      create() {}
      /** Return mock File entries for pruning tests. */
      list() { return native.files.map(entry => new MockFile(entry.name)); }
    },
    File: MockFile,
  };
});
vi.mock('./audioDownload', () => ({ downloadAudio: native.audio }));
vi.mock('./pictureDownload', () => ({ downloadPicture: native.picture }));

const id = 'a'.repeat(64), bytes = new Uint8Array([1, 2, 3]);
const saves = [
  { name: 'downloaded picture', indexed: false, save: () => savePictureAsset(id, 'https://example.test/picture') },
  { name: 'downloaded speech', indexed: true, save: () => saveSpeechAsset('speech-key', id, 'https://example.test/audio') },
  ...(['photo', 'picture', 'speech'] as const).map(kind => ({
    name: `restored ${kind}`, indexed: kind === 'speech',
    save: () => writeSyncAsset({ kind, id, hash: id, ...(kind === 'speech' ? { key: 'speech-key' } : {}) }, bytes),
  })),
];

describe('native asset write completion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    native.audio.mockResolvedValue(bytes);
    native.picture.mockResolvedValue(bytes);
    native.run.mockResolvedValue(undefined);
  });

  it.each(saves)('waits for $name bytes before reporting success or indexing speech', async ({ save, indexed }) => {
    let finish!: () => void;
    native.write.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    let saved = false;
    const pending = save().then(() => { saved = true; });
    await vi.waitFor(() => expect(native.write).toHaveBeenCalledWith(bytes));
    expect(saved).toBe(false);
    expect(native.run).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(saved).toBe(true);
    expect(native.run).toHaveBeenCalledTimes(indexed ? 1 : 0);
  });

  it.each(saves)('propagates a failed $name write without creating a speech index entry', async ({ save }) => {
    native.write.mockRejectedValue(new Error('Disk full'));
    await expect(save()).rejects.toThrow('Disk full');
    expect(native.run).not.toHaveBeenCalled();
  });

  it('prunes speech index rows and wav files not retained by active boards', async () => {
    const keepId = 'b'.repeat(64), dropId = 'c'.repeat(64);
    native.getAll.mockResolvedValue([{ key: '["Keep","en"]', asset_id: keepId }, { key: '["Drop","en"]', asset_id: dropId }]);
    native.files = [{ name: `${keepId}.wav` }, { name: `${dropId}.wav` }];
    await pruneSpeech(new Set(['["Keep","en"]']));
    expect(native.run).toHaveBeenCalledWith('DELETE FROM speech WHERE key = ?', '["Drop","en"]');
    expect(native.deleteFile).toHaveBeenCalledTimes(1);
    expect(native.deleteFile).toHaveBeenCalledWith(`${dropId}.wav`);
  });
});
