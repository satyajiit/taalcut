// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The arithmetic behind the clip grid's windowing: how many columns fit, how
 * tall a row is, and which rows are on screen. Pure, so it is unit tested
 * apart from the DOM. Tiles are 9:16 frames (the shape of the short being
 * made) with a caption line under each.
 */
export interface GridMetrics {
  readonly columns: number;
  /** Width of one tile's frame, px. */
  readonly tile: number;
  /** Height of one row: frame, caption, gap. */
  readonly row: number;
  readonly gap: number;
}

export const GRID = {
  /** Narrowest a frame may be before a column drops. */
  minTile: 124,
  gap: 12,
  /** The caption line under each frame and the space above it. */
  caption: 26,
  /** Tile padding (the hover surface around the frame), each side. */
  pad: 4,
} as const;

export function gridMetrics(width: number, options: Partial<typeof GRID> = {}): GridMetrics {
  const { minTile, gap, caption, pad } = { ...GRID, ...options };
  const outer = minTile + pad * 2;
  const columns = Math.max(1, Math.floor((width + gap) / (outer + gap)));
  const tile = Math.max(1, (width - gap * (columns - 1)) / columns - pad * 2);
  return { columns, tile, gap, row: Math.round(tile * (16 / 9) + caption + pad * 2 + gap) };
}

export interface RowRange {
  /** First row to draw. */
  readonly start: number;
  /** One past the last row to draw. */
  readonly end: number;
}

/**
 * Rows that intersect the viewport, plus `overscan` rows each side so a fast
 * scroll never shows a gap before React catches up.
 */
export function visibleRows(
  scrollTop: number,
  viewport: number,
  gridTop: number,
  row: number,
  rows: number,
  overscan = 3,
): RowRange {
  if (rows === 0 || row <= 0) return { start: 0, end: 0 };
  const top = scrollTop - gridTop;
  const first = Math.floor(top / row);
  const last = Math.ceil((top + viewport) / row);
  return {
    start: Math.max(0, Math.min(rows, first - overscan)),
    end: Math.max(0, Math.min(rows, last + overscan)),
  };
}

/** The tile an arrow, Home, End, Page Up or Page Down moves to from `index`; null for any other key. */
export function moveIndex(
  key: string,
  index: number,
  count: number,
  columns: number,
  pageRows: number,
): number | null {
  if (count === 0) return null;
  const clamp = (n: number) => Math.max(0, Math.min(count - 1, n));
  switch (key) {
    case 'ArrowRight':
      return clamp(index + 1);
    case 'ArrowLeft':
      return clamp(index - 1);
    case 'ArrowDown':
      return clamp(index + columns);
    case 'ArrowUp':
      return clamp(index - columns);
    case 'PageDown':
      return clamp(index + columns * pageRows);
    case 'PageUp':
      return clamp(index - columns * pageRows);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
