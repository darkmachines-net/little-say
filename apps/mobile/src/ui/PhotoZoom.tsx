import Slider from '@react-native-community/slider';
import { MAX_PHOTO_ZOOM } from '@little-say/core';
import { theme } from './theme';

export type PhotoZoomProps = { value: number; onChange: (zoom: number) => void; disabled: boolean };
export function PhotoZoom({ value, onChange, disabled }: PhotoZoomProps) {
  return <Slider accessibilityLabel="Photo zoom" minimumValue={1} maximumValue={MAX_PHOTO_ZOOM} step={0.01} value={value} onValueChange={onChange} disabled={disabled} minimumTrackTintColor={theme.accent} maximumTrackTintColor={theme.line} thumbTintColor={theme.accent} style={{ height: 44, width: '100%' }} />;
}
