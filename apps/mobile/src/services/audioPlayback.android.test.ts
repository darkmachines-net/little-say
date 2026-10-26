/** @file Verifies Android clip queuing, fallback, timeouts, and cancellation across native command races. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LatestSpeechQueue, type Tile } from '@little-say/core';
import type { TileAudioStatus } from './tileAudio.android';
import { starterLibrary } from '../../../../tests/fixtures/library';
import { audioPlayback } from './audioPlayback.android';
import { hybridSpeech } from './hybridSpeech';

const native = vi.hoisted(() => ({ available: true, play: vi.fn(), stop: vi.fn(), addListener: vi.fn() }));
vi.mock('./tileAudio.android', () => ({ get default() { return native.available ? native : null; } }));

type Listener = {
  /** Deliver a native status to this subscription, including deliberately stale test events. */
  emit: (status: TileAudioStatus) => void;
  remove: ReturnType<typeof vi.fn>;
};
let listeners: Listener[];
const flush = () => vi.advanceTimersByTimeAsync(0);
const currentId = () => native.play.mock.calls.at(-1)![0] as string;

describe('Android tile audio', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listeners = [];
    native.available = true;
    native.play.mockReset().mockResolvedValue(undefined);
    native.stop.mockReset().mockResolvedValue(undefined);
    native.addListener.mockReset().mockImplementation((_event, emit) => {
      const listener = { emit, remove: vi.fn() };
      listeners.push(listener);
      return listener;
    });
  });
  afterEach(async () => { await flush(); vi.clearAllTimers(); vi.useRealTimers(); });

  it('finishes the active tile, plays only the latest pending tile, and permits repeats', async () => {
    const system = { speak: vi.fn(), stop: vi.fn() };
    const changed = vi.fn();
    const tile = starterLibrary().boards[0].tiles[0];
    const latest = { ...tile, id: 'latest' };
    const queue = new LatestSpeechQueue<Tile>(hybridSpeech(system, audioPlayback(), () => ({ id: 'clip', uri: 'file:///clip.wav' })), changed);
    queue.enqueue(tile); await flush();
    const firstId = currentId();
    expect(native.play).toHaveBeenCalledWith(firstId, 'file:///clip.wav');
    queue.enqueue({ ...tile, id: 'discarded' }); queue.enqueue(latest);
    expect(native.play).toHaveBeenCalledOnce();
    listeners[0].emit({ id: firstId, state: 'ended' }); await flush();
    const secondId = currentId();
    expect(secondId).not.toBe(firstId);
    expect(changed).toHaveBeenLastCalledWith(latest, null);
    expect(native.play).toHaveBeenCalledTimes(2);
    // An already-delivered callback and an old event sent to the new subscription are both ignored.
    listeners[0].emit({ id: firstId, state: 'error' });
    listeners[1].emit({ id: firstId, state: 'ended' });
    expect(changed).toHaveBeenLastCalledWith(latest, null);
    listeners[1].emit({ id: secondId, state: 'ended' }); await flush();
    expect(changed).toHaveBeenLastCalledWith(null, null);
    queue.enqueue(latest); await flush();
    listeners[2].emit({ id: currentId(), state: 'ended' }); await flush();
    expect(native.play).toHaveBeenCalledTimes(3);
    expect(native.stop).toHaveBeenCalledTimes(3);
    expect(listeners.every(listener => listener.remove.mock.calls.length === 1)).toBe(true);
    expect(system.speak).not.toHaveBeenCalled();
    queue.stop();
  });

  it('releases failed clips and falls back to system speech even after readiness', async () => {
    const system = { speak: vi.fn(), stop: vi.fn() }; const changed = vi.fn();
    const tile = starterLibrary().boards[0].tiles[0];
    const queue = new LatestSpeechQueue<Tile>(hybridSpeech(system, audioPlayback(), () => ({ id: 'clip', uri: 'file:///clip.wav' })), changed);
    queue.enqueue(tile); await flush();
    const id = currentId();
    listeners[0].emit({ id, state: 'ready' });
    await vi.advanceTimersByTimeAsync(4000);
    expect(system.speak).not.toHaveBeenCalled();
    listeners[0].emit({ id, state: 'error' }); await flush();
    expect(native.stop).toHaveBeenCalledExactlyOnceWith(id);
    expect(system.speak).toHaveBeenCalledOnce();
    listeners[0].emit({ id, state: 'ended' });
    expect(changed).toHaveBeenLastCalledWith(tile, null);
    system.speak.mock.calls[0][1]();
    expect(changed).toHaveBeenLastCalledWith(null, null);
    queue.stop();
  });

  it('fails an unloaded clip once after three seconds and ignores late readiness', async () => {
    const driver = audioPlayback(); const done = vi.fn(); const failed = vi.fn();
    driver.speak('file:///missing.wav', done, failed); await flush();
    const id = currentId();
    await vi.advanceTimersByTimeAsync(3000);
    listeners[0].emit({ id, state: 'ready' }); listeners[0].emit({ id, state: 'ended' });
    expect(native.stop).toHaveBeenCalledExactlyOnceWith(id);
    expect(failed).toHaveBeenCalledOnce(); expect(done).not.toHaveBeenCalled();
    expect(listeners[0].remove).toHaveBeenCalledOnce();
  });

  it('cancels before a queued native start without playing or calling fallback', async () => {
    const driver = audioPlayback(); const done = vi.fn(); const failed = vi.fn();
    driver.speak('file:///clip.wav', done, failed); driver.stop(); driver.stop();
    await vi.advanceTimersByTimeAsync(4000);
    expect(native.play).not.toHaveBeenCalled(); expect(native.stop).toHaveBeenCalledOnce();
    expect(done).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
    expect(listeners[0].remove).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'])('orders stop before replacement when cancelled start later %ss', async outcome => {
    let resolve!: () => void; let reject!: (error: Error) => void;
    native.play.mockReturnValueOnce(new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
    const driver = audioPlayback(); const oldDone = vi.fn(); const oldFailed = vi.fn(); const done = vi.fn();
    driver.speak('file:///old.wav', oldDone, oldFailed); await flush();
    const oldId = currentId();
    driver.stop(); driver.speak('file:///next.wav', done, vi.fn());
    expect(native.play).toHaveBeenCalledOnce();
    if (outcome === 'resolve') resolve(); else reject(new Error('Cancelled native preparation'));
    await flush();
    const nextId = currentId();
    expect(native.stop).toHaveBeenCalledWith(oldId);
    expect(native.stop.mock.invocationCallOrder[0]).toBeLessThan(native.play.mock.invocationCallOrder[1]);
    expect(native.play).toHaveBeenLastCalledWith(nextId, 'file:///next.wav');
    listeners[0].emit({ id: oldId, state: 'error' });
    expect(oldDone).not.toHaveBeenCalled(); expect(oldFailed).not.toHaveBeenCalled();
    listeners[1].emit({ id: nextId, state: 'ended' }); await flush();
    expect(done).toHaveBeenCalledOnce();
  });

  it('recovers after native preparation rejection and stop rejection', async () => {
    native.play.mockRejectedValueOnce(new Error('Invalid source'));
    native.stop.mockRejectedValueOnce(new Error('Already released'));
    const driver = audioPlayback(); const failed = vi.fn(); const done = vi.fn();
    driver.speak('file:///bad.wav', vi.fn(), failed); await flush();
    expect(failed).toHaveBeenCalledOnce(); expect(listeners[0].remove).toHaveBeenCalledOnce();
    driver.speak('file:///good.wav', done, vi.fn()); await flush();
    listeners[1].emit({ id: currentId(), state: 'ended' }); await flush();
    expect(done).toHaveBeenCalledOnce();
  });

  it('uses speech fallback when the installed binary has no local module', () => {
    native.available = false;
    const failed = vi.fn(); const driver = audioPlayback();
    driver.speak('file:///clip.wav', vi.fn(), failed); driver.stop();
    expect(failed).toHaveBeenCalledOnce(); expect(native.play).not.toHaveBeenCalled();
    expect(native.addListener).not.toHaveBeenCalled();
  });
});
