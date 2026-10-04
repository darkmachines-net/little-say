import { starterLibrary } from '../../../../tests/fixtures/library';
import { describe, expect, it, vi } from 'vitest';
import { LatestSpeechQueue, type SpeechDriver, type Tile } from '@little-say/core';
import { hybridSpeech } from './hybridSpeech';

const tile = starterLibrary().boards[0].tiles[0];
function harness(hasAudio = true) {
  const system = { speak: vi.fn(), stop: vi.fn() } satisfies SpeechDriver<Tile>;
  const audio = { speak: vi.fn(), stop: vi.fn() } satisfies SpeechDriver<string>;
  const driver = hybridSpeech(system, audio, () => hasAudio ? { id: 'clip', uri: 'file:///clip.wav' } : undefined);
  return { system, audio, driver };
}
describe('saved audio playback with device fallback', () => {
  it('uses saved audio without also speaking through TTS', () => {
    const { system, audio, driver } = harness(); const done = vi.fn();
    driver.speak(tile, done, vi.fn());
    expect(audio.speak.mock.calls[0][0]).toBe('file:///clip.wav');
    audio.speak.mock.calls[0][1]();
    expect(done).toHaveBeenCalledOnce(); expect(system.speak).not.toHaveBeenCalled();
  });
  it('immediately uses TTS when the tile has no matching saved audio', () => {
    const { system, audio, driver } = harness(false);
    driver.speak(tile, vi.fn(), vi.fn());
    expect(system.speak.mock.calls[0][0]).toBe(tile); expect(audio.speak).not.toHaveBeenCalled();
  });
  it('falls back once on playback failure without changing text or language', () => {
    const { system, audio, driver } = harness(); const done = vi.fn();
    driver.speak(tile, done, vi.fn());
    audio.speak.mock.calls[0][2](); audio.speak.mock.calls[0][2]();
    audio.speak.mock.calls[0][1](); expect(done).not.toHaveBeenCalled();
    expect(system.speak).toHaveBeenCalledOnce(); expect(system.speak.mock.calls[0][0]).toBe(tile);
    system.speak.mock.calls[0][1](); expect(done).toHaveBeenCalledOnce();
  });
  it('cancels audio and TTS and ignores late callbacks after leaving play', () => {
    const { system, audio, driver } = harness(); const done = vi.fn();
    driver.speak(tile, done, vi.fn()); driver.stop();
    audio.speak.mock.calls[0][1](); audio.speak.mock.calls[0][2]();
    expect(done).not.toHaveBeenCalled(); expect(system.speak).not.toHaveBeenCalled();
    expect(system.stop).toHaveBeenCalled();
  });
  it('keeps the existing current-plus-latest queue for rapid taps', () => {
    const { audio, driver } = harness();
    const queue = new LatestSpeechQueue(driver, vi.fn());
    queue.enqueue(tile); queue.enqueue({ ...tile, id: 'second' }); queue.enqueue({ ...tile, id: 'third' });
    expect(audio.speak).toHaveBeenCalledOnce();
    audio.speak.mock.calls[0][1](); expect(audio.speak).toHaveBeenCalledTimes(2);
    audio.speak.mock.calls[1][1](); queue.stop();
  });
});
