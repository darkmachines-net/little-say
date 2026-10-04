import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecording } from './useRecording.web';

const browser = {
  permission: vi.fn(), report: vi.fn(), instances: [] as Recorder[],
  constructorFailure: false, startFailure: false, stopFailure: false, supported: true,
};
class Recorder {
  static isTypeSupported() { return browser.supported; }
  state = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: MediaStream, options: { mimeType: string }) {
    if (browser.constructorFailure) throw new Error('Constructor failed');
    this.mimeType = options.mimeType; browser.instances.push(this);
  }
  start() { this.state = 'recording'; if (browser.startFailure) throw new Error('Start failed'); }
  stop = vi.fn(() => { if (browser.stopFailure) throw new Error('Stop failed'); this.state = 'inactive'; });
}
function capture() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { stream: { getTracks: () => tracks } as unknown as MediaStream, tracks };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let hook: ReturnType<typeof useRecording>;
let renderer: ReactTestRenderer | undefined;
let document: EventTarget & { hidden: boolean };
let acquired: ReturnType<typeof capture>;
async function mount() {
  function Harness() { hook = useRecording(browser.report); return null; }
  await act(async () => { renderer = create(createElement(Harness)); });
}
async function unmount() { await act(async () => { renderer?.unmount(); renderer = undefined; }); }
beforeEach(() => {
  vi.resetAllMocks(); browser.instances = [];
  browser.constructorFailure = false; browser.startFailure = false; browser.stopFailure = false; browser.supported = true;
  acquired = capture(); browser.permission.mockResolvedValue(acquired.stream);
  document = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: browser.permission } });
  vi.stubGlobal('window', { MediaRecorder: Recorder }); vi.stubGlobal('MediaRecorder', Recorder);
});
afterEach(async () => { await unmount(); vi.unstubAllGlobals(); });

describe('browser voice recording', () => {
  it('collects the final data, releases tracks, and returns a multipart recording', async () => {
    await mount(); await act(async () => { await hook.start(); });
    const instance = browser.instances[0];
    expect(hook.recording).toBe(true);
    let pending!: Promise<FormData>;
    await act(async () => { pending = hook.stop(); });
    expect(acquired.tracks[0].stop).not.toHaveBeenCalled();
    await act(async () => { instance.ondataavailable!({ data: new Blob(['final audio']) }); instance.onstop!(); });
    const audio = (await pending).get('audio') as File;
    expect(await audio.text()).toBe('final audio'); expect(audio.name).toBe('prompt.webm');
    expect(hook.recording).toBe(false);
    for (const track of acquired.tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(browser.report).not.toHaveBeenCalled();
  });

  it.each(['constructor', 'start', 'unsupported'] as const)('releases every acquired track after %s failure', async kind => {
    await mount();
    browser.constructorFailure = kind === 'constructor'; browser.startFailure = kind === 'start'; browser.supported = kind !== 'unsupported';
    await act(async () => { await expect(hook.start()).rejects.toThrow(); });
    expect(hook.recording).toBe(false);
    for (const track of acquired.tracks) expect(track.stop).toHaveBeenCalledOnce();
    await unmount();
    for (const track of acquired.tracks) expect(track.stop).toHaveBeenCalledOnce();
  });

  it('releases tracks and settles stop even when MediaRecorder.stop throws', async () => {
    await mount(); await act(async () => { await hook.start(); }); browser.stopFailure = true;
    await act(async () => { await expect(hook.stop()).rejects.toThrow('The recording failed'); });
    for (const track of acquired.tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(hook.recording).toBe(false);
  });

  it('continues releasing tracks if recorder stop and an individual track stop both throw', async () => {
    await mount(); await act(async () => { await hook.start(); }); browser.stopFailure = true;
    acquired.tracks[0].stop.mockImplementation(() => { throw new Error('Track already gone'); });
    await act(async () => { await hook.cleanup(); });
    for (const track of acquired.tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(hook.recording).toBe(false);
  });

  it.each(['error', 'unexpected stop'] as const)('reports capture-time %s and stops the microphone immediately', async kind => {
    await mount(); await act(async () => { await hook.start(); });
    const instance = browser.instances[0];
    await act(async () => { if (kind === 'error') instance.onerror!(); else { instance.state = 'inactive'; instance.onstop!(); } });
    expect(browser.report).toHaveBeenCalledOnce(); expect(hook.recording).toBe(false);
    for (const track of acquired.tracks) expect(track.stop).toHaveBeenCalledOnce();
  });

  it.each(['cleanup', 'background', 'unmount'] as const)('settles a pending stop on %s and ignores late events after a new capture', async kind => {
    await mount(); await act(async () => { await hook.start(); });
    const old = browser.instances[0];
    const lateData = old.ondataavailable!, lateStop = old.onstop!, lateError = old.onerror!;
    let pending!: Promise<FormData | Error>;
    await act(async () => { pending = hook.stop().catch(error => error as Error); });
    if (kind === 'unmount') await unmount();
    else await act(async () => { if (kind === 'cleanup') await hook.cleanup(); else { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); } });
    expect(await pending).toEqual(new Error('Recording cancelled.'));
    for (const track of acquired.tracks) expect(track.stop).toHaveBeenCalledOnce();
    if (kind === 'unmount') await mount();
    const next = capture(); browser.permission.mockResolvedValue(next.stream);
    await act(async () => { await hook.start(); lateData({ data: new Blob(['stale audio']) }); lateStop(); lateError(); });
    expect(hook.recording).toBe(true); expect(browser.report).not.toHaveBeenCalled();
    for (const track of next.tracks) expect(track.stop).not.toHaveBeenCalled();
    let body!: Promise<FormData>;
    await act(async () => { body = hook.stop(); const current = browser.instances.at(-1)!; current.ondataavailable!({ data: new Blob(['new audio']) }); current.onstop!(); });
    expect(await ((await body).get('audio') as File).text()).toBe('new audio');
  });

  it('releases a delayed permission result after closing the dialog', async () => {
    const permission = deferred<MediaStream>(); browser.permission.mockReturnValue(permission.promise);
    await mount(); let pending!: Promise<void | Error>;
    await act(async () => { pending = hook.start().catch(error => error as Error); });
    await unmount(); permission.resolve(acquired.stream);
    expect(await pending).toEqual(new Error('Recording cancelled.'));
    expect(browser.instances).toHaveLength(0);
    for (const track of acquired.tracks) expect(track.stop).toHaveBeenCalledOnce();
  });

  it('keeps the latest capture when an older permission request resolves late', async () => {
    const permission = deferred<MediaStream>(); browser.permission.mockReturnValueOnce(permission.promise);
    await mount(); let pending!: Promise<void | Error>;
    await act(async () => { pending = hook.start().catch(error => error as Error); });
    const next = capture(); browser.permission.mockResolvedValue(next.stream);
    await act(async () => { await hook.start(); permission.resolve(acquired.stream); await pending; });
    expect(await pending).toEqual(new Error('Recording cancelled.')); expect(hook.recording).toBe(true);
    for (const track of acquired.tracks) expect(track.stop).toHaveBeenCalledOnce();
    for (const track of next.tracks) expect(track.stop).not.toHaveBeenCalled();
  });

  it('releases the previous session before replacing its stream reference', async () => {
    await mount(); await act(async () => { await hook.start(); });
    const next = capture(); browser.permission.mockResolvedValue(next.stream);
    await act(async () => { await hook.start(); });
    for (const track of acquired.tracks) expect(track.stop).toHaveBeenCalledOnce();
    for (const track of next.tracks) expect(track.stop).not.toHaveBeenCalled();
    expect(hook.recording).toBe(true);
  });
});
