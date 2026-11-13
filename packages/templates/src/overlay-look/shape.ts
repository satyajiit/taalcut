// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The shape round an overlay's words, from its settled pixels (BRK1-GFX): a fill is a still, even colour round the
 * words that the moving picture doesn't share; the shape is how far that colour reaches before it stops on every
 * side; its corners are how far in along the diagonal the fill starts; a tail is fill reaching past one bottom
 * corner; and the words are the pixels far from the fill. With no fill the words sit on the picture: their colour
 * is what stays still in their box. Pure; region pixel coordinates.
 */
import {
  distance,
  grow,
  inside,
  medianColour,
  pixel,
  points,
  type PixelRect,
  type RegionImage,
  type Rgb,
} from './pixels';

/** A pixel this close to the fill is fill (RGB distance; video noise and edges stay under it). */
export const FILL_NEAR = 32;
/** A pixel that moved less than this across the settled frames is still. */
export const STILL = 28;
/** Ink: this far from the fill. */
const INK_FAR = 70;
/** A tail reaches this share of the shape's height past its side, and fills this share of the space past its corner. */
const TAIL_REACH = 0.1;
const TAIL_SPILL = 0.03;

export interface Settled {
  readonly median: RegionImage;
  readonly spread: Uint8Array;
}

export interface ShapeRead {
  readonly fill: Rgb;
  readonly rect: PixelRect;
  /** Corner radius in pixels (the corners without a tail). */
  readonly radius: number;
  readonly tail: 'none' | 'left' | 'right';
  /** Every side stopped inside the region (a shape, not a still wall). */
  readonly bounded: boolean;
  /** Share of the ring round the words that is still and the fill's colour. */
  readonly evenness: number;
}

const still = (settled: Settled, x: number, y: number) =>
  settled.spread[y * settled.median.width + x]! <= STILL;
const isFill = (settled: Settled, fill: Rgb, x: number, y: number) =>
  still(settled, x, y) && distance(pixel(settled.median, x, y), fill) <= FILL_NEAR;

/** The fill round the words: the still ring's median colour, when most of the ring is still and that colour. */
export function fillOf(settled: Settled, words: PixelRect): { fill: Rgb; evenness: number } | null {
  const height = words.bottom - words.top;
  const bounds = { left: 0, top: 0, right: settled.median.width, bottom: settled.median.height };
  const ring = grow(words, { x: Math.max(2, height * 0.6), y: Math.max(2, height * 0.45) }, bounds);
  const around: Rgb[] = [];
  let total = 0;
  for (const [x, y] of points(ring)) {
    if (inside(words, x, y)) continue;
    total++;
    if (still(settled, x, y)) around.push(pixel(settled.median, x, y));
  }
  if (total === 0 || around.length / total < 0.6) return null;
  const fill = medianColour(around);
  const near = around.filter((colour) => distance(colour, fill) <= FILL_NEAR).length;
  const evenness = near / total;
  return evenness >= 0.6 ? { fill, evenness } : null;
}

/** How far fill reaches from (x, y) stepping (dx, dy), through gaps up to `gap` (ink, ticks); null at the edge. */
function reach(
  settled: Settled,
  fill: Rgb,
  from: readonly [number, number],
  step: readonly [number, number],
  gap: number,
) {
  const { width, height } = settled.median;
  let [x, y] = from;
  let last: number | null = null;
  let missing = 0;
  for (;;) {
    x += step[0];
    y += step[1];
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    if (isFill(settled, fill, x, y)) {
      last = step[0] !== 0 ? x : y;
      missing = 0;
    } else if (++missing > gap) return last ?? (step[0] !== 0 ? x : y);
  }
}

const median = (values: readonly (number | null)[]) => {
  const known = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  return known.length === 0 ? null : known[Math.floor((known.length - 1) / 2)]!;
};

/** The first step in along the diagonal from a corner that is fill: a corner of radius r starts at 0.29 r. */
function cornerRadius(
  settled: Settled,
  fill: Rgb,
  corner: readonly [number, number],
  into: readonly [number, number],
  most: number,
) {
  for (let step = 0; step <= most; step++)
    if (isFill(settled, fill, corner[0] + into[0] * step, corner[1] + into[1] * step))
      return step / (1 - Math.SQRT1_2);
  return most / (1 - Math.SQRT1_2);
}

/**
 * Share of the pixels just past a bottom corner, outside the shape, that are fill: beside the shape's lower half
 * and under its corner, where a speech tail reaches.
 */
function spill(settled: Settled, fill: Rgb, rect: PixelRect, side: 'left' | 'right'): number {
  const height = rect.bottom - rect.top;
  const reach = Math.max(2, Math.round(height * 0.35));
  const clip = (zone: PixelRect): PixelRect => ({
    left: Math.max(0, zone.left),
    top: Math.max(0, zone.top),
    right: Math.min(settled.median.width, zone.right),
    bottom: Math.min(settled.median.height, zone.bottom),
  });
  const beside = clip({
    left: side === 'left' ? rect.left - reach : rect.right,
    right: side === 'left' ? rect.left : rect.right + reach,
    top: Math.round(rect.bottom - height * 0.5),
    bottom: Math.round(rect.bottom + height * 0.15),
  });
  const under = clip({
    left: side === 'left' ? rect.left : rect.right - reach,
    right: side === 'left' ? rect.left + reach : rect.right,
    top: rect.bottom,
    bottom: Math.round(rect.bottom + height * 0.2),
  });
  let outside = 0;
  let filled = 0;
  for (const zone of [beside, under])
    for (const [x, y] of points(zone)) {
      outside++;
      if (isFill(settled, fill, x, y)) filled++;
    }
  return outside === 0 ? 0 : filled / outside;
}

/**
 * A tail's reach: how many columns past the shape's side, beside its lower half, the fill goes on without a break,
 * as a share of the shape's height. A rounded corner blurred by scaling or an encode reaches a pixel or so; a tail
 * reaches a fifth of the height or more.
 */
function protrusion(settled: Settled, fill: Rgb, rect: PixelRect, side: 'left' | 'right'): number {
  const height = rect.bottom - rect.top;
  const top = Math.max(0, Math.round(rect.bottom - height * 0.5));
  const bottom = Math.min(settled.median.height, Math.round(rect.bottom + height * 0.25));
  const most = Math.round(height * 0.6);
  let reach = 0;
  for (let step = 0; step < most; step++) {
    const x = side === 'left' ? rect.left - 1 - step : rect.right + step;
    if (x < 0 || x >= settled.median.width) break;
    let any = false;
    for (let y = top; y < bottom && !any; y++) any = isFill(settled, fill, x, y);
    if (!any) break;
    reach = step + 1;
  }
  return reach / height;
}

/**
 * The bubble's tail side: the fill reaches on past one side beside its lower half (a tail, `TAIL_REACH` of the
 * height or more), with a little of the space past that corner filled, while past the other side it stops within
 * half that. Scaling and encoding blur a rounded corner by a pixel or so on both sides alike, so they grow no tail;
 * nor do they hide one, as a test on whether the corner is square did (BRK1 gate: the analysis copy's frames).
 */
function tailOf(settled: Settled, fill: Rgb, rect: PixelRect): 'none' | 'left' | 'right' {
  const reach = {
    left: protrusion(settled, fill, rect, 'left'),
    right: protrusion(settled, fill, rect, 'right'),
  };
  const spills = { left: spill(settled, fill, rect, 'left'), right: spill(settled, fill, rect, 'right') };
  const tail = (own: 'left' | 'right', other: 'left' | 'right') =>
    reach[own] >= TAIL_REACH && reach[other] <= reach[own] / 2 && spills[own] >= TAIL_SPILL;
  if (tail('right', 'left')) return 'right';
  if (tail('left', 'right')) return 'left';
  return 'none';
}

/** The shape round the words, or null when they sit on the picture. */
export function readShape(settled: Settled, words: PixelRect): ShapeRead | null {
  const found = fillOf(settled, words);
  if (!found) return null;
  const { fill } = found;
  const textHeight = words.bottom - words.top;
  const gap = Math.max(3, Math.round(textHeight * 0.9));
  const middle = Math.round((words.top + words.bottom - 1) / 2);
  const rows = [middle, Math.round(middle - textHeight / 4), Math.round(middle + textHeight / 4)];
  const centre = Math.round((words.left + words.right - 1) / 2);
  const span = Math.max(1, Math.round((words.right - words.left) / 4));
  const columns = [centre - span, centre, centre + span];
  const left = median(rows.map((y) => reach(settled, fill, [words.left, y], [-1, 0], gap)));
  const right = median(rows.map((y) => reach(settled, fill, [words.right - 1, y], [1, 0], gap)));
  const top = median(columns.map((x) => reach(settled, fill, [x, words.top], [0, -1], gap)));
  const bottom = median(columns.map((x) => reach(settled, fill, [x, words.bottom - 1], [0, 1], gap)));
  const bounded = left !== null && right !== null && top !== null && bottom !== null;
  const { width, height } = settled.median;
  const rect: PixelRect = {
    left: left ?? 0,
    top: top ?? 0,
    right: (right ?? width - 1) + 1,
    bottom: (bottom ?? height - 1) + 1,
  };
  const shapeHeight = rect.bottom - rect.top;
  const most = Math.round(shapeHeight / 2);
  const radius = Math.min(
    cornerRadius(settled, fill, [rect.left, rect.top], [1, 1], most),
    cornerRadius(settled, fill, [rect.right - 1, rect.top], [-1, 1], most),
  );
  const tail = bounded ? tailOf(settled, fill, rect) : 'none';
  return { fill, rect, radius, tail, bounded, evenness: found.evenness };
}

/**
 * The words' colour and how much of their box is ink. On a fill, ink is what is far from it, and its colour is the
 * quarter farthest from the fill (the strokes' cores, not their soft edges); a pixel is solid ink when it is nearer
 * that than the fill. With no fill, ink is what stays still.
 */
export function readInk(
  settled: Settled,
  words: PixelRect,
  fill: Rgb | null,
): { colour: Rgb; share: number } | null {
  const ink: Rgb[] = [];
  let total = 0;
  for (const [x, y] of points(words)) {
    total++;
    const colour = pixel(settled.median, x, y);
    if (fill ? distance(colour, fill) >= INK_FAR && still(settled, x, y) : still(settled, x, y))
      ink.push(colour);
  }
  if (total === 0 || ink.length < 4) return null;
  if (!fill) return { colour: medianColour(ink), share: ink.length / total };
  const farthest = [...ink].sort((a, b) => distance(b, fill) - distance(a, fill));
  const core = medianColour(farthest.slice(0, Math.max(2, Math.ceil(farthest.length / 4))));
  const solid = ink.filter((colour) => distance(colour, core) < distance(colour, fill)).length;
  return { colour: core, share: solid / total };
}

/** A weight from how much of the words' box is ink: regular type covers about a sixth of it, bold a quarter. */
export function weightOf(share: number): number {
  if (share < 0.2) return 400;
  if (share < 0.26) return 500;
  if (share < 0.32) return 600;
  if (share < 0.4) return 700;
  return 800;
}
