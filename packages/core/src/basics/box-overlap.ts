// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Overlap of two axis-aligned boxes given by their top-left corner and size, in any one unit: pixels (render's
 * `Rect`) or shares of the frame (the analysis's `NormalisedBox`).
 */

export interface TopLeftBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The area two boxes share; 0 when they are apart or only touch. `inset` is taken off the shared width and height
 * first, so boxes that overlap by no more than it on either axis count as apart (render's graphics check: a pixel).
 */
export function overlapArea(a: TopLeftBox, b: TopLeftBox, inset = 0): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) - inset;
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) - inset;
  return width > 0 && height > 0 ? width * height : 0;
}
