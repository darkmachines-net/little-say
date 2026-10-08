/** @file Simulates provider and journal failures to prove retries preserve IDs and never repeat ambiguous successful work. */

import { describe, expect, it, vi } from 'vitest';
import { runOperation, type OperationStore, type Provider } from './operation';
import type { Operation } from './contract';

function fixture() {
  const states = new Map<string, Operation<any>>(); const history: Operation<any>[] = [];
  const store: OperationStore = {
    /** Read the latest in-memory durable snapshot. */
    operation(key) { return states.get(key); },
    /** Persist a separate sequence exactly as the real append-only journal does. */
    save(state) { const next = { ...state, schema: 1 as const, sequence: (states.get(state.key)?.sequence || 0) + 1 }; states.set(state.key, next); history.push(next); return next; },
  };
  const provider: Provider<string> = {
    find: vi.fn(async () => []), start: vi.fn(async () => 'id-1'), status: vi.fn(async () => 'complete' as const), verify: vi.fn(async id => `verified:${id}`),
  };
  return { store, provider, history };
}
describe('recoverable external operations', () => {
  it('persists intent and ID before verifying completion, then reuses the exact ID', async () => {
    const { store, provider, history } = fixture();
    expect(await runOperation(store, 'build-android', provider)).toBe('verified:id-1');
    expect(history.map(s => s.status)).toEqual(['intent', 'running', 'complete']);
    await runOperation(store, 'build-android', provider); expect(provider.start).toHaveBeenCalledTimes(1);
    expect(provider.verify).toHaveBeenLastCalledWith('id-1');
  });
  it('reconciles an accepted request whose response was lost', async () => {
    const { store, provider } = fixture(); vi.mocked(provider.start).mockRejectedValueOnce(new Error('lost response'));
    await expect(runOperation(store, 'build-ios', provider)).rejects.toThrow('lost response');
    vi.mocked(provider.find).mockResolvedValue(['accepted-id']);
    expect(await runOperation(store, 'build-ios', provider)).toBe('verified:accepted-id'); expect(provider.start).toHaveBeenCalledTimes(1);
  });
  it('does not blindly retry an unknown creation outcome', async () => {
    const { store, provider } = fixture(); store.save({ key: 'ota', status: 'intent', ids: [] });
    await expect(runOperation(store, 'ota', provider)).rejects.toThrow('Unknown outcome'); expect(provider.start).not.toHaveBeenCalled();
  });
  it('resumes a queued build after a bounded wait expires', async () => {
    const { store, provider } = fixture(); vi.mocked(provider.status).mockResolvedValue('running');
    await expect(runOperation(store, 'build', provider, { polls: 2, pause: async () => {} })).rejects.toThrow('still running');
    vi.mocked(provider.status).mockResolvedValue('complete'); await runOperation(store, 'build', provider);
    expect(provider.start).toHaveBeenCalledTimes(1);
  });
  it('retries only a confirmed failed operation and preserves its earlier IDs', async () => {
    const { store, provider } = fixture(); vi.mocked(provider.status).mockResolvedValueOnce('failed');
    await expect(runOperation(store, 'submit-ios', provider)).rejects.toThrow('failed at provider');
    vi.mocked(provider.find).mockResolvedValue(['id-1']); vi.mocked(provider.start).mockResolvedValue('id-2');
    await runOperation(store, 'submit-ios', provider); expect(store.operation('submit-ios')?.ids).toEqual(['id-1', 'id-2']);
  });
  it('rejects duplicate matches and changed verification without allocating a replacement', async () => {
    const { store, provider } = fixture(); vi.mocked(provider.find).mockResolvedValue(['id-1', 'id-2']);
    await expect(runOperation(store, 'build', provider)).rejects.toThrow('Multiple provider'); expect(provider.start).not.toHaveBeenCalled();
    vi.mocked(provider.find).mockResolvedValue([]); vi.mocked(provider.verify).mockRejectedValue(new Error('wrong fingerprint'));
    await expect(runOperation(store, 'build', provider)).rejects.toThrow('wrong fingerprint');
    await expect(runOperation(store, 'build', provider)).rejects.toThrow('wrong fingerprint'); expect(provider.start).toHaveBeenCalledTimes(1);
  });
  it('keeps successful platform work when another platform fails', async () => {
    const { store, provider } = fixture(); await runOperation(store, 'android', provider);
    vi.mocked(provider.status).mockResolvedValueOnce('failed'); await expect(runOperation(store, 'ios', provider)).rejects.toThrow();
    await runOperation(store, 'android', provider); expect(provider.start).toHaveBeenCalledTimes(2);
    expect(store.operation('android')?.status).toBe('complete'); expect(store.operation('ios')?.status).toBe('failed');
  });
});
