/** @file Fits ordered cards into balanced rows for playback and compact, optionally scrollable previews. */

export interface CardRect { x: number; y: number; width: number; height: number; }
export interface GridOptions {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Permit taller content in a scrolling editor preview, never in the child play surface. */
  scroll?: boolean;
}
export interface GridLayout {
  /** Rectangles follow saved card order; callers attach stable card IDs without reordering. */
  rects: CardRect[];
  rowCounts: number[];
  width: number;
  height: number;
  /** False means no arrangement meets the minimum targets in these bounds. */
  fits: boolean;
}

/**
 * Measure balanced rows in logical pixels. Rows differ by at most one card and shorter rows use their
 * available width. Prefer large minimum sides, with soft penalties for elongated cards and uneven
 * rows. Compact caps center each row; scroll mode grows height only when no fitted candidate exists.
 * Invalid/unmeasured bounds or impossible minimum targets return no rectangles, with fits=false.
 */
export function gridLayout(count: number, width: number, height: number, gap = 12, options: GridOptions = {}): GridLayout {
  const empty: GridLayout = { rects: [], rowCounts: [], width: 0, height: 0, fits: false };
  const { minWidth = 44, minHeight = 44, maxWidth = Infinity, maxHeight = Infinity, scroll = false } = options;
  if (!Number.isInteger(count) || count < 1 || !Number.isFinite(width) || !Number.isFinite(height) ||
    width <= 0 || height <= 0 || !Number.isFinite(gap) || gap < 0 ||
    !Number.isFinite(minWidth) || !Number.isFinite(minHeight) || minWidth <= 0 || minHeight <= 0 ||
    !(maxWidth >= minWidth) || !(maxHeight >= minHeight)) return empty;

  let best: { rows: number[]; widths: number[]; cellHeight: number; height: number; overflow: boolean; score: number } | undefined;
  for (let rows = 1; rows <= count; rows++) {
    const remainder = count % rows;
    const rowCounts = Array.from({ length: rows }, (_, i) => Math.floor(count / rows) + (i < remainder ? 1 : 0));
    const widths = rowCounts.map(n => Math.min(maxWidth, (width - gap * (n - 1)) / n));
    const availableHeight = (height - gap * (rows - 1)) / rows;
    const cellHeight = Math.min(maxHeight, scroll ? Math.max(minHeight, availableHeight) : availableHeight);
    const shortest = Math.min(cellHeight, ...widths);
    if (Math.min(...widths) < minWidth || cellHeight < minHeight) continue;
    const contentHeight = cellHeight * rows + gap * (rows - 1);
    const overflow = contentHeight > height + 0.01;
    const distortion = Math.max(...widths.map(w => Math.abs(Math.log(w / cellHeight))));
    // Relative penalties behave consistently across window sizes. A small uniform-row preference
    // avoids 2+1+1 when an equally usable four-card portrait arrangement has equal rows.
    const score = shortest / (1 + distortion * 0.15 + (remainder ? 0.04 : 0));
    if (!best || (best.overflow && !overflow) || (best.overflow === overflow && score > best.score)) {
      best = { rows: rowCounts, widths, cellHeight, height: Math.max(height, contentHeight), overflow, score };
    }
  }
  if (!best) return empty;
  const selected = best;
  const usedHeight = selected.cellHeight * selected.rows.length + gap * (selected.rows.length - 1);
  const rects = selected.rows.flatMap((n, row) => Array.from({ length: n }, (_, column) => ({
    x: (width - (selected.widths[row] * n + gap * (n - 1))) / 2 + column * (selected.widths[row] + gap),
    y: (selected.height - usedHeight) / 2 + row * (selected.cellHeight + gap),
    width: selected.widths[row], height: selected.cellHeight,
  })));
  return { rects, rowCounts: selected.rows, width, height: selected.height, fits: true };
}
