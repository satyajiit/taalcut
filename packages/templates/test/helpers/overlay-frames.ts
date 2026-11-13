// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Synthetic RGB frames for the overlay design tests (BRK1-GFX): a moving, noisy picture with an overlay drawn on
 * it: a rounded shape with an optional tail, block "letters" for words, typing dots, and per-frame opacity for
 * fades. No real media.
 */
import type { RgbFrame } from '../../src/overlay-look';

export type Colour = readonly [number, number, number];

export interface DrawnOverlay {
  /** The words' box in pixels: left, top, width, height. */
  readonly words: readonly [number, number, number, number];
  /** Padding round the words to the shape's edge; null draws words on the picture. */
  readonly pad: { readonly x: number; readonly y: number } | null;
  readonly fill: Colour;
  readonly ink: Colour;
  /** Corner radius as a share of the shape's height. */
  readonly radius: number;
  readonly tail: 'none' | 'left' | 'right';
  /** [start, end) frames the words show on. */
  readonly start: number;
  readonly end: number;
  /** Frames before `start` the shape shows on with typing dots instead of words. */
  readonly typingFrames?: number;
  /** Frames to fade in over from `start` (0: a cut). */
  readonly fadeFrames?: number;
  /** HFW1: frames the shape grows from its middle over, from when it first shows (0: a cut). */
  readonly popFrames?: number;
  /** How far the tail reaches past the shape, as a share of its height (0.3 by default). */
  readonly tailReach?: number;
  /**
   * A chat app's thin hook rather than a filled wedge: the bubble's corner stays round and the tail curls out from
   * its side near the bottom, so little of the space past the corner is filled.
   */
  readonly hook?: boolean;
  /** Two grey read ticks inside the shape, beside the words on the tail's side, as a chat app draws them. */
  readonly receipt?: boolean;
}

export const WIDTH = 360;
/** The ticks' grey. */
const TICK: Colour = [125, 138, 122];
export const HEIGHT = 640;

/** A deterministic hash: the picture's noise changes every frame. */
function noise(x: number, y: number, frame: number, channel: number): number {
  let value = (x * 374761393 + y * 668265263 + frame * 2147483647 + channel * 1274126177) | 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return (value ^ (value >>> 16)) & 255;
}

function shapeRect(overlay: DrawnOverlay) {
  const [left, top, width, height] = overlay.words;
  const pad = overlay.pad ?? { x: 0, y: 0 };
  return { left: left - pad.x, top: top - pad.y, right: left + width + pad.x, bottom: top + height + pad.y };
}

/** Whether (x, y) is inside the drawn shape, tail included. */
function inShape(overlay: DrawnOverlay, x: number, y: number): boolean {
  const rect = shapeRect(overlay);
  const height = rect.bottom - rect.top;
  const radius = overlay.radius * height;
  const tail = Math.round(height * (overlay.tailReach ?? 0.3));
  if (overlay.tail !== 'none' && overlay.hook && y >= rect.bottom - height * 0.3 && y < rect.bottom + 1) {
    const along = (y - (rect.bottom - height * 0.3)) / (height * 0.3 + 1);
    // How far out from the shape’s outermost column on the tail’s side: the hook covers a little of the corner and
    // curls out to `tail` at the bottom.
    const out = overlay.tail === 'right' ? x - (rect.right - 1) : rect.left - x;
    if (out >= -radius * 0.15 && out <= along * along * tail) return true;
  }
  if (!overlay.hook && overlay.tail !== 'none' && y >= rect.bottom - height * 0.45 && y < rect.bottom + 2) {
    const along = (y - (rect.bottom - height * 0.45)) / (height * 0.45 + 2);
    const out = along * tail;
    if (overlay.tail === 'right' && x >= rect.right - radius && x < rect.right + out) return true;
    if (overlay.tail === 'left' && x < rect.left + radius && x >= rect.left - out) return true;
  }
  if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return false;
  const cx = x < rect.left + radius ? rect.left + radius : x >= rect.right - radius ? rect.right - radius : x;
  const cy = y < rect.top + radius ? rect.top + radius : y >= rect.bottom - radius ? rect.bottom - radius : y;
  return Math.hypot(x - cx, y - cy) <= radius;
}

/** In the shape as it grows from its middle over `popFrames` from when it first shows (HFW1). */
function inGrown(overlay: DrawnOverlay, frame: number, x: number, y: number): boolean {
  const pop = overlay.popFrames ?? 0;
  const since = frame - (overlay.start - (overlay.typingFrames ?? 0));
  if (pop === 0 || since >= pop) return inShape(overlay, x, y);
  const scale = (since + 1) / (pop + 1);
  const rect = shapeRect(overlay);
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  return inShape(overlay, Math.round(cx + (x - cx) / scale), Math.round(cy + (y - cy) / scale));
}

/** Block letters: vertical strokes a third of the box, with a bar along the middle. */
function inWords(overlay: DrawnOverlay, x: number, y: number): boolean {
  const [left, top, width, height] = overlay.words;
  if (x < left || x >= left + width || y < top || y >= top + height) return false;
  const column = (x - left) % 6;
  return column < 2 || (y - top >= height / 2 - 1 && y - top < height / 2 + 1);
}

/** Two ticks, each a short and a long stroke, a word's height from the words on the tail's side. */
function inTicks(overlay: DrawnOverlay, x: number, y: number): boolean {
  const [left, top, width, height] = overlay.words;
  const span = 14;
  const x0 = overlay.tail === 'left' ? left - height - span : left + width + height;
  const base = top + height - 2;
  for (const offset of [0, 6]) {
    const dx = x - (x0 + offset);
    const dy = base - y;
    if (dx >= 0 && dx < 3 && Math.abs(dy - dx) <= 1) return true;
    if (dx >= 3 && dx < 8 && Math.abs(dy - (8 - dx)) <= 1) return true;
  }
  return false;
}

function inDots(overlay: DrawnOverlay, x: number, y: number): boolean {
  const [left, top, , height] = overlay.words;
  const cy = top + height / 2;
  return [0, 1, 2].some((index) => Math.hypot(x - (left + 4 + index * 8), y - cy) <= 2);
}

/**
 * What the breakdown's own media path does to a frame before the reader sees it: the reel scaled down to the
 * analysis copy, re-encoded and sampled again blurs every edge by a pixel or so. A 3×3 box blur stands in for it.
 */
export function soften(image: RgbFrame): RgbFrame {
  const { width, height, rgb } = image;
  const out = new Uint8Array(rgb.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const sx = x + dx;
            const sy = y + dy;
            if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
            sum += rgb[(sy * width + sx) * 3 + channel]!;
            count++;
          }
        out[(y * width + x) * 3 + channel] = Math.round(sum / count);
      }
  return { ...image, rgb: out };
}

export function drawFrame(frame: number, overlays: readonly DrawnOverlay[]): RgbFrame {
  const rgb = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      let colour: [number, number, number] = [
        noise(x, y, frame, 0),
        noise(x, y, frame, 1),
        noise(x, y, frame, 2),
      ];
      for (const overlay of overlays) {
        const typing = overlay.typingFrames ?? 0;
        if (frame < overlay.start - typing || frame >= overlay.end) continue;
        const fade = overlay.fadeFrames ?? 0;
        const alpha =
          fade > 0 && frame >= overlay.start ? Math.min(1, (frame - overlay.start + 1) / (fade + 1)) : 1;
        const shaped = overlay.pad !== null && inGrown(overlay, frame, x, y);
        const inked = frame >= overlay.start ? inWords(overlay, x, y) : inDots(overlay, x, y);
        const ticked = frame >= overlay.start && overlay.receipt === true && inTicks(overlay, x, y);
        const drawn = inked ? overlay.ink : ticked ? TICK : shaped ? overlay.fill : null;
        if (!drawn) continue;
        colour = [0, 1, 2].map((index) =>
          Math.round(drawn[index]! * alpha + colour[index]! * (1 - alpha)),
        ) as [number, number, number];
      }
      rgb.set(colour, (y * WIDTH + x) * 3);
    }
  return { frame, width: WIDTH, height: HEIGHT, rgb };
}

/** The words' box normalised, as a text overlay's `box`. */
export function boxOf(overlay: DrawnOverlay) {
  const [left, top, width, height] = overlay.words;
  return { x: left / WIDTH, y: top / HEIGHT, width: width / WIDTH, height: height / HEIGHT };
}
