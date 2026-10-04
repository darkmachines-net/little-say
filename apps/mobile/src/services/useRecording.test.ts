import React, { act, useEffect } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFormDataPatch } from 'expo/src/winter/FormData';
import { convertFormDataAsync } from 'expo/src/winter/fetch/convertFormData';
import { useRecording } from './useRecording';

const native = vi.hoisted(() => ({
  released: false,
  invalidAccesses: 0,
  uri: 'file:///cache/prompt.m4a',
  permission: vi.fn(),
  audioMode: vi.fn(),
  prepare: vi.fn(),
  record: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
  appState: null as ((state: string) => void) | null,
}));

vi.mock('react-native', () => ({
  AppState: { addEventListener: (_event: string, callback: (state: string) => void) => {
    native.appState = callback;
    return { remove: () => { native.appState = null; } };
  } },
}));

vi.mock('expo-audio', () => {
  const assertAlive = () => {
    if (native.released) {
      native.invalidAccesses++;
      throw new Error('Unable to find the native shared object associated with given JavaScript object');
    }
  };
  const recorder = {
    get uri() { assertAlive(); return native.uri; },
    prepareToRecordAsync: () => { assertAlive(); return native.prepare(); },
    record: () => { assertAlive(); return native.record(); },
    stop: () => { assertAlive(); return native.stop(); },
  };
  return {
    RecordingPresets: { HIGH_QUALITY: {} },
    requestRecordingPermissionsAsync: native.permission,
    setAudioModeAsync: native.audioMode,
    useAudioRecorder: () => {
      // Like Expo's hook, this cleanup runs before the caller's passive cleanup.
      useEffect(() => { native.released = false; return () => { native.released = true; }; }, []);
      return recorder;
    },
  };
});

vi.mock('expo-file-system/legacy', () => ({ deleteAsync: native.remove }));
vi.mock('expo-file-system', () => ({
  // Native File implements Blob without inheriting the JS Blob class.
  File: class {
    constructor(readonly uri: string) {}
    get name() { return this.uri.split('/').at(-1); }
    type = 'audio/mp4';
    bytes = async () => new Uint8Array([0, 1, 2, 255]);
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

let hook: ReturnType<typeof useRecording>;
let renderer: ReactTestRenderer | undefined;
async function mount() {
  function Harness() { hook = useRecording(); return null; }
  await act(async () => { renderer = create(React.createElement(Harness)); });
}
async function unmount() {
  await act(async () => { renderer?.unmount(); renderer = undefined; });
}

beforeEach(() => {
  vi.resetAllMocks();
  native.released = false;
  native.invalidAccesses = 0;
  native.uri = 'file:///cache/prompt.m4a';
  native.permission.mockResolvedValue({ granted: true });
  native.audioMode.mockResolvedValue(undefined);
  native.prepare.mockResolvedValue(undefined);
  native.stop.mockResolvedValue(undefined);
  native.remove.mockResolvedValue(undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Exercise Expo's real FormData patch and multipart encoder, not Node's
  // different FormData implementation (which missed the original regression).
  class ReactNativeFormData { _parts: unknown[] = []; }
  vi.stubGlobal('FormData', installFormDataPatch(ReactNativeFormData as unknown as typeof FormData));
});

afterEach(async () => {
  await unmount();
  expect(native.invalidAccesses).toBe(0);
  vi.unstubAllGlobals();
});

describe('native voice recording', () => {
  it('uploads a File using the installed Expo multipart encoder', async () => {
    await mount();
    await act(async () => { await hook.start(); });
    expect(hook.recording).toBe(true);
    let form!: FormData;
    await act(async () => { form = await hook.stop(); });
    const { body } = await convertFormDataAsync(form, 'test-boundary');
    const multipart = new TextDecoder().decode(body);
    expect(multipart).toContain('name="audio"; filename="prompt.m4a"');
    expect(multipart).toContain('content-type: audio/mp4');
    expect(Array.from(body)).toEqual(expect.arrayContaining([0, 1, 2, 255]));
    expect(hook.recording).toBe(false);
    expect(native.remove).not.toHaveBeenCalled(); // Keep the file until upload finishes.
    await act(async () => { await hook.cleanup(); });
    expect(native.remove).toHaveBeenCalledWith(native.uri, { idempotent: true });
  });

  it('demonstrates why the previous URI-only payload fails on this Expo version', async () => {
    const form = new FormData();
    form.append('audio', { uri: native.uri, name: 'prompt.m4a', type: 'audio/mp4' } as unknown as Blob);
    await expect(convertFormDataAsync(form)).rejects.toThrow('Unsupported FormDataPart implementation');
  });

  it('can close without ever opening the microphone', async () => {
    await mount();
    await unmount();
    expect(native.released).toBe(true);
    expect(native.stop).not.toHaveBeenCalled();
    expect(native.remove).not.toHaveBeenCalled();
    await hook.cleanup(); // A late request's finally block is safe too.
  });

  it('deletes the saved file after Expo releases an active recorder', async () => {
    await mount();
    await act(async () => { await hook.start(); });
    await unmount();
    expect(native.released).toBe(true);
    expect(native.stop).not.toHaveBeenCalled(); // Expo owns stop/release on unmount.
    expect(native.remove).toHaveBeenCalledWith(native.uri, { idempotent: true });
    expect(native.audioMode).toHaveBeenLastCalledWith({ allowsRecording: false });
  });

  it('cancels a pending permission request when the dialog closes', async () => {
    const permission = deferred<{ granted: boolean }>();
    native.permission.mockReturnValueOnce(permission.promise);
    await mount();
    const pending = hook.start().catch(error => error as Error);
    await unmount();
    permission.resolve({ granted: true });
    expect(await pending).toEqual(new Error('Recording cancelled.'));
    expect(native.prepare).not.toHaveBeenCalled();
    expect(native.record).not.toHaveBeenCalled();
  });

  it('does not prepare a released recorder after awaiting audio mode', async () => {
    const mode = deferred<void>();
    native.audioMode.mockReturnValueOnce(mode.promise);
    await mount();
    let pending!: Promise<unknown>;
    await act(async () => { pending = hook.start().catch(error => error); });
    await unmount();
    mode.resolve();
    expect(await pending).toEqual(new Error('Recording cancelled.'));
    expect(native.prepare).not.toHaveBeenCalled();
    expect(native.audioMode).toHaveBeenLastCalledWith({ allowsRecording: false });
  });

  it('does not start a released recorder after preparation finishes', async () => {
    const preparation = deferred<void>();
    native.prepare.mockReturnValueOnce(preparation.promise);
    await mount();
    let pending!: Promise<unknown>;
    await act(async () => { pending = hook.start().catch(error => error); });
    expect(native.prepare).toHaveBeenCalledOnce();
    await unmount();
    preparation.resolve();
    expect(await pending).toEqual(new Error('Recording cancelled.'));
    expect(native.record).not.toHaveBeenCalled();
    expect(native.audioMode).toHaveBeenLastCalledWith({ allowsRecording: false });
  });

  it('does not read a released recorder after stop completes', async () => {
    const stopped = deferred<void>();
    native.stop.mockReturnValueOnce(stopped.promise);
    await mount();
    await act(async () => { await hook.start(); });
    const pending = hook.stop().catch(error => error as Error);
    await unmount();
    stopped.resolve();
    expect(await pending).toEqual(new Error('Recording cancelled.'));
  });

  it('stops and cleans up on background, then allows another recording', async () => {
    await mount();
    await act(async () => { await hook.start(); });
    await act(async () => { native.appState?.('background'); });
    expect(native.stop).toHaveBeenCalledOnce();
    expect(native.remove).toHaveBeenCalledOnce();
    expect(hook.recording).toBe(false);
    await act(async () => { await hook.start(); });
    expect(hook.recording).toBe(true);
    await act(async () => { await hook.stop(); await hook.cleanup(); });
    expect(native.stop).toHaveBeenCalledTimes(2);
    expect(native.remove).toHaveBeenCalledTimes(2);
  });

  it('resets audio mode and deletes the file when starting the recorder fails', async () => {
    native.record.mockImplementationOnce(() => { throw new Error('Microphone unavailable'); });
    await mount();
    await act(async () => { await expect(hook.start()).rejects.toThrow('Microphone unavailable'); });
    expect(hook.recording).toBe(false);
    expect(native.remove).toHaveBeenCalledOnce();
    expect(native.audioMode).toHaveBeenLastCalledWith({ allowsRecording: false });
  });
});
