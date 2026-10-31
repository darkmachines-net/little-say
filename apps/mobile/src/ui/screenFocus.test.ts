/** @file Verifies deferred heading focus preserves an early interaction with a new screen's language search. */

import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useScreenFocus } from './screenFocus';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
let screen: ReactTestRenderer | undefined;
afterEach(async () => { if (screen) await act(async () => screen!.unmount()); screen = undefined; vi.unstubAllGlobals(); });

it.each([false, true])('focuses the heading only when a control has not already been focused: %s', async interacted => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let frame!: FrameRequestCallback;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const body = {};
  vi.stubGlobal('document', { body, documentElement: {}, activeElement: interacted ? { role: 'textbox' } : body });
  let heading!: ReturnType<typeof useScreenFocus>;
  function Harness() { heading = useScreenFocus(); return null; }
  await act(async () => { screen = create(React.createElement(Harness)); });
  const focus = vi.fn();
  heading.current = { focus } as unknown as NonNullable<typeof heading.current>;
  await act(async () => frame(0));
  expect(focus).toHaveBeenCalledTimes(interacted ? 0 : 1);
});
