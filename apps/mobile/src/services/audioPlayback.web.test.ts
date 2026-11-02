/** @file Verifies complete web clip starts, shared output reuse, queue transitions, cancellation, and failure recovery. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LatestSpeechQueue, type Tile } from '@little-say/core';
import { starterLibrary } from '../../../../tests/fixtures/library';
import { hybridSpeech } from './hybridSpeech';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function bufferSource() {
  return {
    buffer: null as AudioBuffer | null, onended: null as (() => void) | null,
    start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
let sources: ReturnType<typeof bufferSource>[];
let output: {
  state: AudioContextState; currentTime: number; destination: object;
  resume: ReturnType<typeof vi.fn>; decodeAudioData: ReturnType<typeof vi.fn>;
  createBufferSource: ReturnType<typeof vi.fn>;
};
let Context: ReturnType<typeof vi.fn>;
let fetchClip: ReturnType<typeof vi.fn>;
let audioPlayback: typeof import('./audioPlayback.web').audioPlayback;
const buffer = { duration: 0.5 } as AudioBuffer;

describe('browser clip playback', () => {
  beforeEach(async () => {
    vi.resetModules(); vi.useFakeTimers(); sources = [];
    output = {
      state: 'running', currentTime: 10, destination: {},
      resume: vi.fn().mockResolvedValue(undefined), decodeAudioData: vi.fn().mockResolvedValue(buffer),
      createBufferSource: vi.fn(() => { const source = bufferSource(); sources.push(source); return source; }),
    };
    Context = vi.fn(function () { return output; });
    fetchClip = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    vi.stubGlobal('AudioContext', Context); vi.stubGlobal('fetch', fetchClip);
    ({ audioPlayback } = await import('./audioPlayback.web'));
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('resumes during the tap and waits for both output and the whole decoded clip before starting at zero', async () => {
    const ready = deferred<void>(); const decoded = deferred<AudioBuffer>();
    output.resume.mockReturnValue(ready.promise); output.decodeAudioData.mockReturnValue(decoded.promise);
    const driver = audioPlayback(); const done = vi.fn(); const failed = vi.fn();
    expect(Context).not.toHaveBeenCalled();
    driver.speak('blob:mama', done, failed);
    expect(output.resume).toHaveBeenCalledOnce();
    expect(output.resume.mock.invocationCallOrder[0]).toBeLessThan(fetchClip.mock.invocationCallOrder[0]);
    await flush(); decoded.resolve(buffer); await flush();
    expect(sources).toHaveLength(0);
    output.currentTime = 12; ready.resolve(); await flush();
    expect(sources[0].buffer).toBe(buffer);
    expect(sources[0].connect).toHaveBeenCalledWith(output.destination);
    expect(sources[0].start).toHaveBeenCalledWith(12.05, 0);
    // Completion follows the audio event, never a guessed duration or the preparation timeout.
    await vi.advanceTimersByTimeAsync(4000);
    expect(done).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
    const ended = sources[0].onended!; ended(); ended();
    expect(done).toHaveBeenCalledOnce(); expect(sources[0].disconnect).toHaveBeenCalledOnce();
    expect(sources[0].buffer).toBeNull();
  });

  it('waits for decoding even if output activation has already finished', async () => {
    const decoded = deferred<AudioBuffer>(); output.decodeAudioData.mockReturnValue(decoded.promise);
    const driver = audioPlayback(); driver.speak('blob:mama', vi.fn(), vi.fn()); await flush();
    expect(sources).toHaveLength(0);
    decoded.resolve(buffer); await flush();
    expect(sources[0].start).toHaveBeenCalledWith(10.05, 0); driver.stop();
  });

  it('reuses the page output for repeats and independent editor/play drivers without stopping another source', async () => {
    const preview = audioPlayback(); const play = audioPlayback();
    preview.speak('blob:mama', vi.fn(), vi.fn()); await flush(); sources[0].onended!();
    preview.speak('blob:mama', vi.fn(), vi.fn()); await flush();
    play.speak('blob:other', vi.fn(), vi.fn()); await flush();
    preview.stop();
    expect(Context).toHaveBeenCalledOnce(); expect(output.resume).toHaveBeenCalledTimes(3);
    expect(sources[2].stop).not.toHaveBeenCalled(); play.stop();
  });

  it.each(['load', 'decode', 'resume'])('cancels pending %s and ignores late resolution or rejection', async stage => {
    const pending = deferred<any>();
    if (stage === 'load') fetchClip.mockReturnValueOnce(pending.promise);
    if (stage === 'decode') output.decodeAudioData.mockReturnValueOnce(pending.promise);
    if (stage === 'resume') output.resume.mockReturnValueOnce(pending.promise);
    const driver = audioPlayback(); const done = vi.fn(); const failed = vi.fn();
    driver.speak('blob:old', done, failed); await flush();
    const signal = fetchClip.mock.calls[0][1].signal as AbortSignal;
    driver.stop(); driver.stop();
    expect(signal.aborted).toBe(true);
    driver.speak('blob:new', vi.fn(), vi.fn()); await flush();
    if (stage === 'decode') pending.resolve(buffer); else pending.reject(new Error('Late failure'));
    await vi.advanceTimersByTimeAsync(4000);
    expect(sources).toHaveLength(1); expect(sources[0].stop).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled(); driver.stop();
  });

  it('stops scheduled audio and suppresses an already queued ended callback', async () => {
    const driver = audioPlayback(); const done = vi.fn(); const failed = vi.fn();
    driver.speak('blob:mama', done, failed); await flush();
    const ended = sources[0].onended!; driver.stop(); ended();
    expect(sources[0].stop).toHaveBeenCalledOnce(); expect(sources[0].disconnect).toHaveBeenCalledOnce();
    expect(done).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
  });

  it.each(['load', 'decode', 'resume'])('times out stalled %s once and discards late decoded audio', async stage => {
    const pending = deferred<any>();
    if (stage === 'load') fetchClip.mockReturnValueOnce(pending.promise);
    if (stage === 'decode') output.decodeAudioData.mockReturnValueOnce(pending.promise);
    if (stage === 'resume') output.resume.mockReturnValueOnce(pending.promise);
    const driver = audioPlayback(); const done = vi.fn(); const failed = vi.fn();
    driver.speak('blob:mama', done, failed);
    await vi.advanceTimersByTimeAsync(3000);
    expect(failed).toHaveBeenCalledOnce(); expect(fetchClip.mock.calls[0][1].signal.aborted).toBe(true);
    pending.resolve(stage === 'load' ? { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } : buffer);
    await flush(); expect(sources).toHaveLength(0); expect(done).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
  });

  it.each(['context', 'http', 'fetch', 'decode', 'resume', 'start'])('reports %s failure once and permits a fresh attempt', async stage => {
    const error = new Error('Unavailable audio');
    if (stage === 'context') Context.mockImplementationOnce(() => { throw error; });
    if (stage === 'http') fetchClip.mockResolvedValueOnce({ ok: false });
    if (stage === 'fetch') fetchClip.mockRejectedValueOnce(error);
    if (stage === 'decode') output.decodeAudioData.mockRejectedValueOnce(error);
    if (stage === 'resume') output.resume.mockRejectedValueOnce(error);
    if (stage === 'start') output.createBufferSource.mockImplementationOnce(() => {
      const source = bufferSource(); source.start.mockImplementationOnce(() => { throw error; }); sources.push(source); return source;
    });
    const driver = audioPlayback(); const done = vi.fn(); const failed = vi.fn();
    driver.speak('blob:bad', done, failed); await vi.advanceTimersByTimeAsync(4000);
    expect(failed).toHaveBeenCalledOnce(); expect(done).not.toHaveBeenCalled();
    driver.speak('blob:good', done, failed); await flush(); sources.at(-1)!.onended!();
    expect(done).toHaveBeenCalledOnce(); expect(failed).toHaveBeenCalledOnce();
  });

  it('recreates a closed output on the next tap', async () => {
    const driver = audioPlayback(); driver.speak('blob:first', vi.fn(), vi.fn()); await flush(); driver.stop();
    output.state = 'closed'; driver.speak('blob:next', vi.fn(), vi.fn()); await flush();
    expect(Context).toHaveBeenCalledTimes(2); driver.stop();
  });

  it('finishes the current word, advances to only the latest selection, and falls back after a decode failure', async () => {
    const system = { speak: vi.fn(), stop: vi.fn() }; const changes = vi.fn(); const failure = vi.fn();
    const tile = starterLibrary().boards[0].tiles[0]; const latest = { ...tile, id: 'latest' };
    const queue = new LatestSpeechQueue<Tile>(hybridSpeech(system, audioPlayback(), () => ({ id: 'clip', uri: 'blob:mama' })), changes, failure);
    queue.enqueue(tile); await flush(); queue.enqueue({ ...tile, id: 'discard' }); queue.enqueue(latest);
    expect(sources).toHaveLength(1);
    const ended = sources[0].onended!; ended(); await flush(); ended();
    expect(changes).toHaveBeenLastCalledWith(latest, null); expect(sources).toHaveLength(2);
    sources[1].onended!(); expect(changes).toHaveBeenLastCalledWith(null, null);
    output.decodeAudioData.mockRejectedValueOnce(new Error('Bad clip')); queue.enqueue(tile); await flush();
    expect(system.speak).toHaveBeenCalledOnce(); system.speak.mock.calls[0][1]();
    expect(changes).toHaveBeenLastCalledWith(null, null); expect(failure).not.toHaveBeenCalled(); queue.stop();
  });
});
