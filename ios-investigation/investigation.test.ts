/** @file Models supplied and missing completion events, generated WAV bounds, and cancellation. */
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { AudioStatus } from 'expo-audio';
import { LatestSpeechQueue, type Tile } from '@little-say/core';
import { starterLibrary } from '../../tests/fixtures/library';
import { audioPlayback } from '../../apps/mobile/src/services/audioPlayback';
import { hybridSpeech } from '../../apps/mobile/src/services/hybridSpeech';
import { pcmToWav } from '../../apps/server/src/synthesis';
const native = vi.hoisted(() => ({ create: vi.fn(), mode: vi.fn() }));
vi.mock('expo-audio', () => ({ createAudioPlayer: native.create, setAudioModeAsync: native.mode }));
function player() {
  let callback!: (s: AudioStatus) => void;
  const subscription = { remove: vi.fn() };
  return { play: vi.fn(), remove: vi.fn(), subscription,
    addListener: vi.fn((_event: string, cb: typeof callback) => { callback=cb; return subscription; }),
    emit: (s: Partial<AudioStatus>) => callback({isLoaded:true, didJustFinish:false, error:null, playbackState:'readyToPlay', currentTime:0, duration:0.5, playing:true, ...s} as AudioStatus) };
}
function setup() {
  const clips: ReturnType<typeof player>[] = [];
  native.create.mockImplementation(() => { const p=player(); clips.push(p); return p; });
  const changes=vi.fn(), error=vi.fn(), system={speak:vi.fn(), stop:vi.fn()};
  const tile=starterLibrary().boards[0].tiles[0];
  const queue=new LatestSpeechQueue<Tile>(hybridSpeech(system,audioPlayback(),()=>({id:'clip',uri:'file:///clip.wav'})),changes,error);
  return {clips,changes,error,system,tile,queue};
}
beforeEach(()=>{vi.useFakeTimers();native.create.mockReset();native.mode.mockReset().mockResolvedValue(undefined);});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
it('supplied one-shot completions survive 100 repeated plays and later false snapshots',async()=>{
  const s=setup();
  for(let i=0;i<100;i++) {
    s.queue.enqueue(s.tile); await Promise.resolve(); const clip=s.clips[i];
    expect(clip.play).toHaveBeenCalledOnce();
    clip.emit({currentTime:0.5,playing:false,didJustFinish:true});
    clip.emit({currentTime:0.5,playing:false,didJustFinish:false});
    expect(s.changes).toHaveBeenLastCalledWith(null,null);
    expect(clip.remove).toHaveBeenCalledOnce();expect(clip.subscription.remove).toHaveBeenCalledOnce();
  }
  expect(s.system.speak).not.toHaveBeenCalled();expect(s.error).not.toHaveBeenCalled();s.queue.stop();
});
it('injected absent terminal event leaves loaded queue active until existing watchdog',async()=>{
  const s=setup();s.queue.enqueue(s.tile);await Promise.resolve();
  s.clips[0].emit({currentTime:0.5,playing:false});
  const next={...s.tile,id:'next'};s.queue.enqueue(next);
  vi.advanceTimersByTime(19999);expect(s.changes).toHaveBeenLastCalledWith(s.tile,next);
  vi.advanceTimersByTime(1);await Promise.resolve();
  expect(s.error).toHaveBeenCalledWith(s.tile);expect(s.changes).toHaveBeenLastCalledWith(next,null);
  s.clips[1].emit({didJustFinish:true});expect(s.changes).toHaveBeenLastCalledWith(null,null);s.queue.stop();
});
it('actual PCM wrapper declares exact sample length through its supported bounds',()=>{
  for(const length of [2,24000,48000,960000]) {
    const wav=pcmToWav(Buffer.alloc(length));
    expect(wav.length).toBe(length+44);expect(wav.readUInt32LE(4)+8).toBe(wav.length);
    expect(wav.readUInt32LE(40)).toBe(length);expect(wav.readUInt32LE(28)).toBe(48000);
    expect(wav.readUInt16LE(32)).toBe(2);expect(length/wav.readUInt32LE(28)).toBe(length/48000);
  }
  for(const length of [0,1,960002]) expect(()=>pcmToWav(Buffer.alloc(length))).toThrow();
});
it('paused status does not truncate current word; cancel clears pending and stale events cannot settle new word',async()=>{
  const s=setup();s.queue.enqueue(s.tile);await Promise.resolve();
  s.queue.enqueue({...s.tile,id:'pending'});s.clips[0].emit({playing:false,currentTime:0.2});
  expect(s.clips).toHaveLength(1);s.queue.stop();expect(s.changes).toHaveBeenLastCalledWith(null,null);
  const next={...s.tile,id:'new-session'};s.queue.enqueue(next);await Promise.resolve();
  s.clips[0].emit({didJustFinish:true});s.clips[0].emit({error:'old failure'});
  expect(s.changes).toHaveBeenLastCalledWith(next,null);expect(s.system.speak).not.toHaveBeenCalled();
  s.clips[1].emit({didJustFinish:true});expect(s.changes).toHaveBeenLastCalledWith(null,null);s.queue.stop();
});
