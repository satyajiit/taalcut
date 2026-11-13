// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pixels for reading an overlay's design (BRK1-GFX): a region of RGB frames round the overlay's words, the
 * per-pixel median of the frames it is settled in (what stays: the overlay), how much each pixel moved across them
 * (the picture behind moves, the overlay doesn't), and colours compared as RGB distances. Pure.
 */

/** An RGB24 frame, row-major, as media's raw sampler gives it. */
export interface RgbFrame {
  readonly frame: number;
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

/** A pixel rectangle: inclusive left and top, exclusive right and bottom. */
export interface PixelRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export type Rgb = readonly [number, number, number];

/** One frame's pixels inside the region, in the region's coordinates. */
export interface RegionImage {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

/** The region of `frame` inside `rect`. */
export function crop(frame: RgbFrame, rect: PixelRect): RegionImage {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const from = ((rect.top + y) * frame.width + rect.left) * 3;
    rgb.set(frame.rgb.subarray(from, from + width * 3), y * width * 3);
  }
  return { width, height, rgb };
}

export function pixel(image: RegionImage, x: number, y: number): Rgb {
  const at = (y * image.width + x) * 3;
  return [image.rgb[at]!, image.rgb[at + 1]!, image.rgb[at + 2]!];
}

export const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The settled look: each pixel's median over the frames, and its spread (largest channel range). */
export function settle(images: readonly RegionImage[]): { median: RegionImage; spread: Uint8Array } {
  const first = images[0]!;
  const count = first.width * first.height;
  const median = new Uint8Array(count * 3);
  const spread = new Uint8Array(count);
  const values: number[] = new Array<number>(images.length);
  for (let index = 0; index < count; index++) {
    let widest = 0;
    for (let channel = 0; channel < 3; channel++) {
      for (let image = 0; image < images.length; image++)
        values[image] = images[image]!.rgb[index * 3 + channel]!;
      values.sort((a, b) => a - b);
      median[index * 3 + channel] = values[Math.floor((values.length - 1) / 2)]!;
      widest = Math.max(widest, values[values.length - 1]! - values[0]!);
    }
    spread[index] = widest;
  }
  return { median: { width: first.width, height: first.height, rgb: median }, spread };
}

/** The median colour of the pixels, per channel. */
export function medianColour(pixels: readonly Rgb[]): Rgb {
  const channel = (index: 0 | 1 | 2) => {
    const sorted = pixels.map((value) => value[index]).sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
  };
  return [channel(0), channel(1), channel(2)];
}

/** '#rrggbb', lower case. */
export const hex = (colour: Rgb) =>
  `#${colour
    .map((value) =>
      Math.round(Math.min(255, Math.max(0, value)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** Every pixel of `rect` (region coordinates), every `step` pixels. */
export function* points(rect: PixelRect, step = 1): Generator<readonly [number, number]> {
  for (let y = rect.top; y < rect.bottom; y += step)
    for (let x = rect.left; x < rect.right; x += step) yield [x, y];
}

export const inside = (rect: PixelRect, x: number, y: number) =>
  x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;

/** `rect` grown by `by` pixels all round, clipped to `bounds`. */
export function grow(
  rect: PixelRect,
  by: { readonly x: number; readonly y: number },
  bounds: PixelRect,
): PixelRect {
  return {
    left: Math.max(bounds.left, Math.floor(rect.left - by.x)),
    top: Math.max(bounds.top, Math.floor(rect.top - by.y)),
    right: Math.min(bounds.right, Math.ceil(rect.right + by.x)),
    bottom: Math.min(bounds.bottom, Math.ceil(rect.bottom + by.y)),
  };
}
