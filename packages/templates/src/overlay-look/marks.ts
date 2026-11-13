// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Marks inside a chat bubble beside its words (BRK1 gate): a chat app's read ticks (✓✓) sit in the bubble beside
 * the message, apart from it. They are a small, still cluster of pixels far from the fill, inside the shape and away
 * from the words' box (grown enough to take in OCR's tight box: an ellipsis, descenders). Pure; region pixels.
 */
import { distance, grow, inside, pixel, points, type PixelRect, type Rgb } from './pixels';
import { STILL, type Settled } from './shape';

/** Far enough from the fill to be a mark, not the fill's own shading. */
const MARK_FAR = 60;

export interface MarkRead {
  /** Pixels of the cluster. */
  readonly pixels: number;
  /** Its box's width and height as shares of the words' height. */
  readonly width: number;
  readonly height: number;
}

/** The marks inside `shape` away from `words`, or null when there are none to speak of. */
export function marksOf(settled: Settled, fill: Rgb, shape: PixelRect, words: PixelRect): MarkRead | null {
  const textHeight = Math.max(1, words.bottom - words.top);
  const bounds = { left: 0, top: 0, right: settled.median.width, bottom: settled.median.height };
  const away = grow(words, { x: textHeight * 0.8, y: textHeight * 0.4 }, bounds);
  // The shape less a margin: its own anti-aliased edge and corners aren't marks.
  const margin = Math.max(2, Math.round(textHeight * 0.25));
  const within: PixelRect = {
    left: shape.left + margin,
    top: shape.top + margin,
    right: shape.right - margin,
    bottom: shape.bottom - margin,
  };
  let count = 0;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const [x, y] of points(within)) {
    if (inside(away, x, y)) continue;
    if (settled.spread[y * settled.median.width + x]! > STILL) continue;
    if (distance(pixel(settled.median, x, y), fill) < MARK_FAR) continue;
    count++;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  if (count === 0) return null;
  return { pixels: count, width: (right - left + 1) / textHeight, height: (bottom - top + 1) / textHeight };
}

/**
 * Read ticks: a cluster of at least a few pixels, about as tall as the words or less and no wider than two of
 * their heights (one mark, not a second line of words).
 */
export function hasReceipt(marks: MarkRead | null, textHeight: number): boolean {
  if (!marks) return false;
  return (
    marks.pixels >= Math.max(6, textHeight * 0.6) &&
    marks.width >= 0.4 &&
    marks.width <= 2.2 &&
    marks.height <= 1.3
  );
}
