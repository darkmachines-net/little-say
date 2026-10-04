/** @file Provides the browser range input for adjusting photo magnification. */

import { MAX_PHOTO_ZOOM } from '@little-say/core';
import type { PhotoZoomProps } from './PhotoZoom';
import { theme } from './theme';

/** Render a keyboard-accessible range control that reports the selected scale factor. */
export function PhotoZoom({ value, onChange, disabled }: PhotoZoomProps) {
  return <input type="range" aria-label="Photo zoom" min={1} max={MAX_PHOTO_ZOOM} step={0.01} value={value} onChange={event => onChange(Number(event.target.value))} disabled={disabled} style={{ width: '100%', height: 44, margin: 0, accentColor: theme.accent, touchAction: 'none' }} />;
}
