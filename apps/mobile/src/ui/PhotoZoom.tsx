/** @file Provides the native slider for adjusting photo magnification. */

import Slider from '@react-native-community/slider';
import { MAX_PHOTO_ZOOM } from '@little-say/core';
import { theme } from './theme';

export type PhotoZoomProps = {
  value: number;
  /** Report the selected magnification factor; the caller owns the unsaved crop. */
  onChange: (zoom: number) => void;
  disabled: boolean;
};
/** Render a bounded native zoom slider that reports the selected scale factor. */
export function PhotoZoom({ value, onChange, disabled }: PhotoZoomProps) {
  return <Slider accessibilityLabel="Photo zoom" minimumValue={1} maximumValue={MAX_PHOTO_ZOOM} step={0.01} value={value} onValueChange={onChange} disabled={disabled} minimumTrackTintColor={theme.accent} maximumTrackTintColor={theme.line} thumbTintColor={theme.accent} style={{ height: 44, width: '100%' }} />;
}
