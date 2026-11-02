/** @file Verifies native crop responder ownership, pan/pinch updates, and fresh gestures after release or cancellation. */

import React, { act, useState } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type PhotoCrop } from '@little-say/core';
import { PhotoCropSurface } from './PhotoCropSurface';

vi.mock('react-native', () => ({ View: 'View' }));
vi.mock('./PhotoImage', () => ({ PhotoImage: 'PhotoImage' }));

const source = { uri: 'photo.png', width: 1200, height: 800 };
let renderer: ReactTestRenderer;
const changed = vi.fn();
function Harness() {
  const [crop, setCrop] = useState<PhotoCrop>({ zoom: 2, x: 0, y: 0 });
  return React.createElement(PhotoCropSurface, { source, size: 300, crop, onChange: value => { changed(value); setCrop(value); } });
}
const surface = () => renderer.root.findByProps({ accessibilityLabel: 'Photo crop' });
const crop = (): PhotoCrop => renderer.root.findByType(PhotoCropSurface).props.crop;
const contact = (x: number, y: number, identifier = 1) => ({ identifier, pageX: x + 40, pageY: y + 80, locationX: x, locationY: y });
const event = (...touches: ReturnType<typeof contact>[]) => ({ nativeEvent: { ...touches[0], touches } });
async function respond(name: string, ...touches: ReturnType<typeof contact>[]) {
  let result: unknown;
  await act(async () => { result = surface().props[name](event(...touches)); });
  return result;
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); changed.mockClear();
  await act(async () => { renderer = create(React.createElement(Harness)); });
});
afterEach(async () => { await act(async () => renderer.unmount()); vi.unstubAllGlobals(); });

it('blocks Android native scroll interception from the first contact and pans in both directions', async () => {
  expect(surface().props.onStartShouldSetResponder()).toBe(true);
  expect(await respond('onResponderGrant', contact(150, 150))).toBe(true);
  expect(surface().props.onResponderTerminationRequest()).toBe(false);
  await respond('onResponderMove', contact(180, 195));
  expect(crop()).toEqual({ zoom: 2, x: .1, y: .3 });
  await respond('onResponderMove', contact(120, 105));
  expect(crop()).toEqual({ zoom: 2, x: -.1, y: -.3 });
  expect(changed).toHaveBeenLastCalledWith(crop());
});

it('keeps pinch zoom and one-finger panning continuous when fingers join and leave', async () => {
  await respond('onResponderGrant', contact(100, 150));
  await respond('onResponderStart', contact(100, 150), contact(200, 150, 2));
  await respond('onResponderMove', contact(50, 150), contact(250, 150, 2));
  expect(crop()).toEqual({ zoom: 4, x: 0, y: 0 });
  await respond('onResponderEnd', contact(50, 150));
  expect(crop()).toEqual({ zoom: 4, x: 0, y: 0 });
  await respond('onResponderMove', contact(50, 195));
  expect(crop()).toEqual({ zoom: 4, x: 0, y: .1 });
});

it.each(['onResponderRelease', 'onResponderTerminate'])('starts a fresh drag after %s', async end => {
  await respond('onResponderGrant', contact(150, 150));
  await respond('onResponderMove', contact(180, 195));
  const previous = crop();
  await respond(end);
  expect(await respond('onResponderGrant', contact(50, 50))).toBe(true);
  expect(crop()).toEqual(previous);
  await respond('onResponderMove', contact(20, 5));
  expect(crop()).toEqual({ zoom: 2, x: 0, y: 0 });
});
