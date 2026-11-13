// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pixel measures for telling scene text from added text (FIX-SIGN): grey crops, a patch's shift between two frames
 * (block matching by mean absolute difference, coarse to fine), the words' ink, and how much of it changes. Pure;
 * every rectangle is in the crop's own pixels.
 */
import type { PixelRect, RgbFrame } from '../overlay-look';

/** Luma, 0–255, row-major. */
export interface Grey {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

export interface Shift {
  readonly dx: number;
  readonly dy: number;
  /** Mean absolute difference at the shift, and at no shift. */
  readonly error: number;
  readonly still: number;
}

/** The luma of `rect` of an RGB frame (Rec. 601 weights, as the OCR and the design reader see brightness). */
export function greyOf(frame: RgbFrame, rect: PixelRect): Grey {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = ((rect.top + y) * frame.width + rect.left + x) * 3;
      data[y * width + x] = 0.299 * frame.rgb[at]! + 0.587 * frame.rgb[at + 1]! + 0.114 * frame.rgb[at + 2]!;
    }
  return { width, height, data };
}

/** Half the size, each pixel the mean of four. */
export function halve(image: Grey): Grey {
  const width = Math.max(1, image.width >> 1);
  const height = Math.max(1, image.height >> 1);
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const x2 = Math.min(image.width - 1, 2 * x + 1);
      const y2 = Math.min(image.height - 1, 2 * y + 1);
      const at = (row: number, column: number) => image.data[row * image.width + column]!;
      data[y * width + x] = (at(2 * y, 2 * x) + at(2 * y, x2) + at(y2, 2 * x) + at(y2, x2)) / 4;
    }
  return { width, height, data };
}

const scaleRect = (rect: PixelRect, by: number): PixelRect => ({
  left: Math.floor(rect.left * by),
  top: Math.floor(rect.top * by),
  right: Math.max(Math.floor(rect.left * by) + 1, Math.floor(rect.right * by)),
  bottom: Math.max(Math.floor(rect.top * by) + 1, Math.floor(rect.bottom * by)),
});

/** Mean absolute gradient inside `rect`: how much there is to match. */
export function texture(image: Grey, rect: PixelRect): number {
  let sum = 0;
  let count = 0;
  for (let y = rect.top; y < rect.bottom - 1; y++)
    for (let x = rect.left; x < rect.right - 1; x++) {
      const at = y * image.width + x;
      sum +=
        Math.abs(image.data[at + 1]! - image.data[at]!) +
        Math.abs(image.data[at + image.width]! - image.data[at]!);
      count++;
    }
  return count > 0 ? sum / count : 0;
}

/** Mean absolute difference of `rect` in `a` against `rect` moved by (dx, dy) in `b`; Infinity off the image. */
export function difference(a: Grey, b: Grey, rect: PixelRect, dx: number, dy: number): number {
  if (rect.left + dx < 0 || rect.top + dy < 0 || rect.right + dx > b.width || rect.bottom + dy > b.height)
    return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let y = rect.top; y < rect.bottom; y++) {
    const rowA = y * a.width;
    const rowB = (y + dy) * b.width + dx;
    for (let x = rect.left; x < rect.right; x++) sum += Math.abs(a.data[rowA + x]! - b.data[rowB + x]!);
  }
  return sum / ((rect.right - rect.left) * (rect.bottom - rect.top));
}

function search(
  a: Grey,
  b: Grey,
  rect: PixelRect,
  centre: { dx: number; dy: number },
  radius: number,
): { dx: number; dy: number; error: number } {
  let best = { dx: 0, dy: 0, error: Number.POSITIVE_INFINITY };
  for (let dy = centre.dy - radius; dy <= centre.dy + radius; dy++)
    for (let dx = centre.dx - radius; dx <= centre.dx + radius; dx++) {
      const error = difference(a, b, rect, dx, dy);
      // Ties go to the smaller move: a flat patch matches everywhere and has not moved.
      if (
        error < best.error - 1e-6 ||
        (Math.abs(error - best.error) <= 1e-6 && Math.hypot(dx, dy) < Math.hypot(best.dx, best.dy))
      )
        best = { dx, dy, error };
    }
  return best;
}

/**
 * Where `rect` of `a` went in `b`, within `radius` pixels: searched at half size, then refined a pixel round it.
 * `halves` are `a` and `b` halved, when the caller has them.
 */
export function bestShift(
  a: Grey,
  b: Grey,
  rect: PixelRect,
  radius: number,
  halves?: { readonly a: Grey; readonly b: Grey },
): Shift {
  const still = difference(a, b, rect, 0, 0);
  const small = halves ?? { a: halve(a), b: halve(b) };
  const coarse = search(small.a, small.b, scaleRect(rect, 0.5), { dx: 0, dy: 0 }, Math.ceil(radius / 2));
  const fine = search(a, b, rect, { dx: coarse.dx * 2, dy: coarse.dy * 2 }, 1);
  // A coarse match that the fine search can't beat no-shift with stays put.
  return fine.error < still ? { ...fine, still } : { dx: 0, dy: 0, error: still, still };
}

/** Otsu's threshold over the values. */
function otsu(values: readonly number[]): number {
  const bins = new Array<number>(64).fill(0);
  for (const value of values) bins[Math.min(63, Math.max(0, Math.floor(value / 4)))]! += 1;
  const total = values.length;
  const sumAll = bins.reduce((sum, count, bin) => sum + count * bin, 0);
  let below = 0;
  let sumBelow = 0;
  let best = { between: -1, threshold: 128 };
  for (let bin = 0; bin < 63; bin++) {
    below += bins[bin]!;
    sumBelow += bin * bins[bin]!;
    if (below === 0 || below === total) continue;
    const meanBelow = sumBelow / below;
    const meanAbove = (sumAll - sumBelow) / (total - below);
    const between = below * (total - below) * (meanBelow - meanAbove) ** 2;
    if (between > best.between) best = { between, threshold: (bin + 1) * 4 };
  }
  return best.threshold;
}

/** The words' ink: the pixels of `rect` on the minority side of its brightness split, and the split's contrast. */
export function inkOf(image: Grey, rect: PixelRect): { ink: Uint8Array; contrast: number } {
  const values: number[] = [];
  for (let y = rect.top; y < rect.bottom; y++)
    for (let x = rect.left; x < rect.right; x++) values.push(image.data[y * image.width + x]!);
  const threshold = otsu(values);
  const bright = values.filter((value) => value >= threshold).length;
  const inkIsBright = bright <= values.length / 2;
  const ink = Uint8Array.from(values, (value) => (value >= threshold === inkIsBright ? 1 : 0));
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
  return { ink, contrast: at(0.95) - at(0.05) };
}

/** Mean absolute difference over the ink pixels of `rect` in `a` against `b` after the shift. */
export function inkError(
  a: Grey,
  b: Grey,
  rect: PixelRect,
  ink: Uint8Array,
  shift: Pick<Shift, 'dx' | 'dy'>,
): number {
  let sum = 0;
  let count = 0;
  const width = rect.right - rect.left;
  for (let y = rect.top; y < rect.bottom; y++)
    for (let x = rect.left; x < rect.right; x++) {
      if (!ink[(y - rect.top) * width + (x - rect.left)]) continue;
      const bx = x + shift.dx;
      const by = y + shift.dy;
      if (bx < 0 || by < 0 || bx >= b.width || by >= b.height) continue;
      sum += Math.abs(a.data[y * a.width + x]! - b.data[by * b.width + bx]!);
      count++;
    }
  return count > 0 ? sum / count : Number.POSITIVE_INFINITY;
}

/**
 * Something in front of the words, from one side: after the shift, the share of the words' columns that no longer
 * match (mean absolute difference over `threshold`), when those columns are one run from the left or the right end
 * and leave at least a fifth matched. 0 otherwise: all matched, all changed (the words went, or the picture behind
 * plain words moved), or changes scattered across them.
 */
export function sideCover(a: Grey, b: Grey, rect: PixelRect, shift: Shift, threshold: number): number {
  const width = rect.right - rect.left;
  const changed: boolean[] = [];
  for (let x = rect.left; x < rect.right; x++) {
    let sum = 0;
    let count = 0;
    for (let y = rect.top; y < rect.bottom; y++) {
      const bx = x + shift.dx;
      const by = y + shift.dy;
      if (bx < 0 || by < 0 || bx >= b.width || by >= b.height) continue;
      sum += Math.abs(a.data[y * a.width + x]! - b.data[by * b.width + bx]!);
      count++;
    }
    changed.push(count > 0 && sum / count > threshold);
  }
  const share = changed.filter(Boolean).length / Math.max(1, width);
  if (share < 0.15 || share > 0.8) return 0;
  const run = (from: number, step: number) => {
    let k = from;
    while (k >= 0 && k < width && changed[k]) k += step;
    return Math.abs(k - from);
  };
  const fromSide = Math.max(run(0, 1), run(width - 1, -1));
  return fromSide >= 0.9 * share * width ? share : 0;
}

/** Luma this close to the fill's is fill; farther is the shape's edge or what is round it. */
const FILL_LUMA = 14;

/** From `from`, how many steps of `step` until a pixel is not the fill, or null within `limit`. */
function edgeWithin(
  image: Grey,
  from: readonly [number, number],
  step: readonly [number, number],
  fill: number,
  limit: number,
) {
  for (let k = 1; k <= limit; k++) {
    const x = from[0] + step[0] * k;
    const y = from[1] + step[1] * k;
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
    if (Math.abs(image.data[y * image.width + x]! - fill) > 2 * FILL_LUMA) return k;
  }
  return null;
}

/**
 * A still, even fill round the words: the share of the ring outside `words` whose pixels hold still across the
 * frames (at no shift) and sit near their median (0–1), and whether that fill stops on every side within a few
 * lines (a bubble's or a pill's shape, not a wall).
 */
export function fillOf(frames: readonly Grey[], words: PixelRect): { evenness: number; bounded: boolean } {
  const first = frames[0];
  if (!first || frames.length < 2) return { evenness: 0, bounded: false };
  const height = words.bottom - words.top;
  const ring: PixelRect = {
    left: Math.max(0, Math.floor(words.left - Math.max(2, height * 0.6))),
    top: Math.max(0, Math.floor(words.top - Math.max(2, height * 0.45))),
    right: Math.min(first.width, Math.ceil(words.right + Math.max(2, height * 0.6))),
    bottom: Math.min(first.height, Math.ceil(words.bottom + Math.max(2, height * 0.45))),
  };
  const values: number[] = [];
  let total = 0;
  for (let y = ring.top; y < ring.bottom; y++)
    for (let x = ring.left; x < ring.right; x++) {
      if (x >= words.left && x < words.right && y >= words.top && y < words.bottom) continue;
      total++;
      let low = 255;
      let high = 0;
      for (const frame of frames) {
        const value = frame.data[y * frame.width + x]!;
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
      if (high - low <= 16) values.push(first.data[y * first.width + x]!);
    }
  if (total === 0 || values.length === 0) return { evenness: 0, bounded: false };
  const sorted = [...values].sort((a, b) => a - b);
  const fill = sorted[sorted.length >> 1]!;
  const evenness = values.filter((value) => Math.abs(value - fill) <= FILL_LUMA).length / total;
  // Three lines out of each side of the words; the fill must stop on two of them, on every side.
  const across = Math.ceil(3 * height + 0.3 * (words.right - words.left));
  const down = Math.ceil(3 * height);
  const rows = [0.25, 0.5, 0.75].map((share) => Math.floor(words.top + share * height));
  const columns = [0.25, 0.5, 0.75].map((share) =>
    Math.floor(words.left + share * (words.right - words.left)),
  );
  const sides: [number, number][][] = [
    rows.map((y) => [words.left - 1, y]),
    rows.map((y) => [words.right, y]),
    columns.map((x) => [x, words.top - 1]),
    columns.map((x) => [x, words.bottom]),
  ];
  const steps: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  const bounded = sides.every(
    (starts, side) =>
      starts.filter(
        (start) => edgeWithin(first, start, steps[side]!, fill, side < 2 ? across : down) !== null,
      ).length >= 2,
  );
  return { evenness, bounded };
}
