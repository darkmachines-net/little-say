/** @file Shares normalized photo crop geometry and pan/pinch gesture state across platforms. */

export const MAX_PHOTO_ZOOM = 6;
export type PhotoCrop = { zoom: number; x: number; y: number };
export type PhotoSize = { width: number; height: number };
export type PhotoPoint = { x: number; y: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Shared by the crop controls and every rendered tile. Coordinates are relative
 * to the overflow, so the selected region is independent of the displayed size. */
export function photoGeometry(source: PhotoSize, frame: PhotoSize, crop: PhotoCrop) {
  const scale = Math.max(frame.width / source.width, frame.height / source.height) * crop.zoom;
  const width = source.width * scale, height = source.height * scale;
  return { width, height, left: (frame.width - width) / 2 + crop.x * (width - frame.width) / 2, top: (frame.height - height) / 2 + crop.y * (height - frame.height) / 2 };
}

/**
 * Apply a pixel drag to normalized crop offsets, clamping movement to the image overflow so no blank
 * edge is exposed.
 */
export function panPhoto(source: PhotoSize, frame: PhotoSize, crop: PhotoCrop, dx: number, dy: number): PhotoCrop {
  const image = photoGeometry(source, frame, crop);
  return { ...crop, x: image.width - frame.width > 0.001 ? clamp(crop.x + 2 * dx / (image.width - frame.width), -1, 1) : 0, y: image.height - frame.height > 0.001 ? clamp(crop.y + 2 * dy / (image.height - frame.height), -1, 1) : 0 };
}

/** Zoom around the finger midpoint (or the center for slider/keyboard input). */
export function zoomPhoto(source: PhotoSize, frame: PhotoSize, crop: PhotoCrop, zoom: number, anchor = { x: frame.width / 2, y: frame.height / 2 }): PhotoCrop {
  const old = photoGeometry(source, frame, crop);
  const next = { ...crop, zoom: clamp(zoom, 1, MAX_PHOTO_ZOOM) };
  const image = photoGeometry(source, frame, next);
  const left = anchor.x - (anchor.x - old.left) * image.width / old.width;
  const top = anchor.y - (anchor.y - old.top) * image.height / old.height;
  return { ...next, x: image.width - frame.width > 0.001 ? clamp(1 + 2 * left / (image.width - frame.width), -1, 1) : 0, y: image.height - frame.height > 0.001 ? clamp(1 + 2 * top / (image.height - frame.height), -1, 1) : 0 };
}

/** Rebases when a finger joins/leaves, avoiding jumps between pan and pinch. */
export class PhotoGesture {
  private start: { points: PhotoPoint[]; crop: PhotoCrop } | null = null;
  /** Bind source-image and frame dimensions used to translate pointer movement into crop changes. */
  constructor(private source: PhotoSize, private frame: PhotoSize) {}
  /** Discard the current gesture baseline so the next contact starts from the supplied crop. */
  reset() { this.start = null; }
  /**
   * Update a crop from up to two frame-relative pointer positions, rebasing when the contact count
   * changes to avoid jumps.
   */
  move(crop: PhotoCrop, points: PhotoPoint[]): PhotoCrop {
    const next = points.slice(0, 2);
    if (!next.length) { this.reset(); return crop; }
    if (!this.start || this.start.points.length !== next.length) { this.start = { points: next, crop }; return crop; }
    const { points: start, crop: initial } = this.start;
    if (next.length === 1) return panPhoto(this.source, this.frame, initial, next[0].x - start[0].x, next[0].y - start[0].y);
    const midpoint = (p: PhotoPoint[]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
    const distance = (p: PhotoPoint[]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    const from = midpoint(start), to = midpoint(next);
    const scaled = zoomPhoto(this.source, this.frame, initial, initial.zoom * distance(next) / Math.max(1, distance(start)), from);
    return panPhoto(this.source, this.frame, scaled, to.x - from.x, to.y - from.y);
  }
}
