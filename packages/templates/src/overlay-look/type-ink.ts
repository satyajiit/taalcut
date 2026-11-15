// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: which pixels of an overlay are its letters and which their outline, from the settled frames.
 *
 * - **Ink.** Over a moving picture, ink is what stays still in the words' box (grown a little, so an outline is
 *   inside). When the picture round the box is still too, motion tells nothing: a still picture of one colour
 *   leaves as ink what is far from that colour; any other still picture leaves what is in a colour commoner in
 *   the box than round it. On a shape, ink is what is far from its fill. Against a known colour, a cell between
 *   two tones that mixes them is ink too, though the mix may pass near that colour (white into black over grey).
 * - **Tones.** The ink's colours are split in two. Two tones far apart are letters and an outline when one of them
 *   wraps the other: it lies on the ink's edge and the other never does. Two that both reach the picture are
 *   two-colour words, a hard shadow or a still patch beside the letters: one of them is read (the caller says
 *   which). Anything else is one tone.
 *
 * Pure; coordinates are a grid over the working rect of the region image.
 */
import { distance, grow, medianColour, pixel, type PixelRect, type Rgb } from './pixels';
import { STILL, type Settled } from './shape';

export const TYPE_INK = {
  /** The words' box grown by this share of its height holds the ink: an outline reaches past OCR's box. */
  grow: 0.25,
  /** The working rect past the ink's box, as a share of the words' height: the picture a shadow is read against. */
  margin: 1,
  /** With this share of the picture round the box still, the picture is still: motion alone tells nothing. */
  stillBackground: 0.6,
  /** A still picture is one colour when this share of it is within `plainNear` (RGB) of its median. */
  plain: 0.7,
  plainNear: 48,
  /** Over a still picture of many colours, ink's colour is this many times as common in the box as round it. */
  specific: 1.5,
  /** Ink is this far (RGB) from a still picture of one colour, or from a shape's fill. */
  far: 70,
  /** Two tones: their centres this far apart (RGB) and each this share of the ink. */
  tonesApart: 90,
  toneShare: 0.12,
  /**
   * One tone wraps the other: the inner one never lies on the ink's edge (up to this share of its cells, for a
   * broken outline) and the outer one does, by at least `outlineOnEdge` of its cells more.
   */
  lettersOnEdge: 0.08,
  outlineOnEdge: 0.03,
} as const;

/** A grid of cells over a rect of the region image, row-major. */
export interface Grid {
  readonly rect: PixelRect;
  readonly width: number;
  readonly height: number;
}

export const LETTERS = 1;
export const OUTLINE = 2;

export interface InkRead {
  readonly grid: Grid;
  /** 1 where a cell is ink. */
  readonly ink: Uint8Array;
  readonly count: number;
  /** The colour behind the words when it is one colour: a still picture's, or a shape's fill. Else null. */
  readonly background: Rgb | null;
  /** The picture behind was still: the ink was told by colour, not by motion. */
  readonly stillBackground: boolean;
  /** What the box mostly is where it is not ink: `background`, or the picture's middle colour there. */
  readonly behind: Rgb;
}

export interface Tones {
  /** 0, LETTERS or OUTLINE for each cell of the grid. */
  readonly labels: Uint8Array;
  readonly letters: Rgb;
  readonly outline: Rgb | null;
  /** A second tone was there and was not an outline (two-colour words, or a still patch of the picture). */
  readonly mixed: boolean;
}

const luma = (colour: Rgb) => 0.299 * colour[0] + 0.587 * colour[1] + 0.114 * colour[2];

function gridOver(rect: PixelRect): Grid {
  return { rect, width: rect.right - rect.left, height: rect.bottom - rect.top };
}

/** A colour's cell in a 8×8×8 cube: near colours share one, or neighbours. */
const cube = (colour: Rgb) => ((colour[0] >> 5) << 6) | ((colour[1] >> 5) << 3) | (colour[2] >> 5);

/**
 * The ink of the words at `words`: see the header. `within` is the shape the words sit on (ink stays inside it);
 * `fill` its colour, or null for words on the picture. Null when there is next to nothing to read.
 */
export function readInkMask(
  settled: Settled,
  words: PixelRect,
  fill: Rgb | null,
  within: PixelRect | null,
): InkRead | null {
  const { median, spread } = settled;
  const bounds = { left: 0, top: 0, right: median.width, bottom: median.height };
  const height = Math.max(1, words.bottom - words.top);
  const by = height * TYPE_INK.grow;
  let zone = grow(words, { x: by, y: by }, bounds);
  if (within)
    zone = {
      left: Math.max(zone.left, within.left),
      top: Math.max(zone.top, within.top),
      right: Math.min(zone.right, within.right),
      bottom: Math.min(zone.bottom, within.bottom),
    };
  if (zone.right - zone.left < 2 || zone.bottom - zone.top < 2) return null;
  const reach = height * TYPE_INK.margin;
  const grid = gridOver(grow(zone, { x: reach, y: reach }, bounds));
  const still = (x: number, y: number) => spread[y * median.width + x]! <= STILL;
  const inZone = (x: number, y: number) =>
    x >= zone.left && x < zone.right && y >= zone.top && y < zone.bottom;

  // What is still in the box and round it, by colour.
  const inside = new Uint32Array(512);
  const outside = new Uint32Array(512);
  const around: Rgb[] = [];
  let zoneCells = 0;
  let aroundCells = 0;
  for (let y = grid.rect.top; y < grid.rect.bottom; y++)
    for (let x = grid.rect.left; x < grid.rect.right; x++) {
      const boxed = inZone(x, y);
      if (boxed) zoneCells++;
      else aroundCells++;
      if (!still(x, y)) continue;
      const colour = pixel(median, x, y);
      if (boxed) inside[cube(colour)]!++;
      else {
        outside[cube(colour)]!++;
        around.push(colour);
      }
    }
  const stillBackground =
    fill === null && aroundCells > 0 && around.length / aroundCells >= TYPE_INK.stillBackground;
  let background = fill;
  if (stillBackground) {
    const middle = medianColour(around);
    const near = around.filter((colour) => distance(colour, middle) <= TYPE_INK.plainNear).length;
    if (near / around.length >= TYPE_INK.plain) background = middle;
  }
  // A still picture of many colours: only a colour the box has more of than the picture round it is ink.
  const byColour = stillBackground && background === null;
  const specific = (colour: Rgb) => {
    const at = cube(colour);
    return inside[at]! * aroundCells >= TYPE_INK.specific * outside[at]! * zoneCells;
  };

  const ink = new Uint8Array(grid.width * grid.height);
  const rest: Rgb[] = [];
  let count = 0;
  for (let y = zone.top; y < zone.bottom; y++)
    for (let x = zone.left; x < zone.right; x++) {
      const colour = pixel(median, x, y);
      const is =
        still(x, y) &&
        (background === null || distance(colour, background) >= TYPE_INK.far) &&
        (!byColour || specific(colour));
      if (!is) {
        rest.push(colour);
        continue;
      }
      ink[(y - grid.rect.top) * grid.width + (x - grid.rect.left)] = 1;
      count++;
    }
  if (count < 12) return null;
  if (background) count += closeMixes(settled, grid, zone, ink);
  const behind = background ?? (rest.length > 0 ? medianColour(rest) : ([128, 128, 128] as const));
  return { grid, ink, count, background, stillBackground, behind };
}

/**
 * Against a known colour, the cells left out between two ink cells of different tones though they mix the two:
 * a soft edge between letters and their outline can pass near the colour behind. They become ink; how many.
 */
function closeMixes(settled: Settled, grid: Grid, zone: PixelRect, ink: Uint8Array): number {
  const colourAt = (x: number, y: number) => pixel(settled.median, x, y);
  const isInk = (x: number, y: number) =>
    x >= zone.left && x < zone.right && y >= zone.top && y < zone.bottom
      ? ink[(y - grid.rect.top) * grid.width + (x - grid.rect.left)] === 1
      : false;
  const mixes = (colour: Rgb, a: Rgb, b: Rgb) => {
    const span = distance(a, b);
    if (span < TYPE_INK.tonesApart) return false;
    // Between the two, and no further from either than they are from each other.
    return distance(colour, a) < span && distance(colour, b) < span;
  };
  const found: number[] = [];
  for (let y = zone.top; y < zone.bottom; y++)
    for (let x = zone.left; x < zone.right; x++) {
      if (isInk(x, y) || settled.spread[y * settled.median.width + x]! > STILL) continue;
      const colour = colourAt(x, y);
      const across =
        isInk(x - 1, y) && isInk(x + 1, y) && mixes(colour, colourAt(x - 1, y), colourAt(x + 1, y));
      const down =
        isInk(x, y - 1) && isInk(x, y + 1) && mixes(colour, colourAt(x, y - 1), colourAt(x, y + 1));
      if (across || down) found.push((y - grid.rect.top) * grid.width + (x - grid.rect.left));
    }
  for (const index of found) ink[index] = 1;
  return found.length;
}

/** The colours of the grid's cells with `label` (every ink cell when `labels` is the ink itself). */
function coloursOf(settled: Settled, grid: Grid, labels: Uint8Array, label: number): Rgb[] {
  const out: Rgb[] = [];
  for (let index = 0; index < labels.length; index++) {
    if (labels[index] !== label) continue;
    const x = grid.rect.left + (index % grid.width);
    const y = grid.rect.top + Math.floor(index / grid.width);
    out.push(pixel(settled.median, x, y));
  }
  return out;
}

/** Ink's colours in two clusters (k-means from the darkest and the lightest): each cell's cluster, and the centres. */
function twoTones(settled: Settled, read: InkRead) {
  const { grid, ink } = read;
  const cells: number[] = [];
  const colours: Rgb[] = [];
  for (let index = 0; index < ink.length; index++) {
    if (ink[index] !== 1) continue;
    cells.push(index);
    const x = grid.rect.left + (index % grid.width);
    const y = grid.rect.top + Math.floor(index / grid.width);
    colours.push(pixel(settled.median, x, y));
  }
  let dark = colours[0]!;
  let light = colours[0]!;
  for (const colour of colours) {
    if (luma(colour) < luma(dark)) dark = colour;
    if (luma(colour) > luma(light)) light = colour;
  }
  let centres: [Rgb, Rgb] = [dark, light];
  const side = new Uint8Array(colours.length);
  for (let round = 0; round < 8; round++) {
    const sums = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    colours.forEach((colour, at) => {
      const which = distance(colour, centres[0]) <= distance(colour, centres[1]) ? 0 : 1;
      side[at] = which;
      const sum = sums[which]!;
      sum[0]! += colour[0];
      sum[1]! += colour[1];
      sum[2]! += colour[2];
      sum[3]! += 1;
    });
    const next = sums.map((sum, which) =>
      sum[3]! === 0 ? centres[which]! : ([sum[0]! / sum[3]!, sum[1]! / sum[3]!, sum[2]! / sum[3]!] as Rgb),
    ) as [Rgb, Rgb];
    const moved = distance(next[0], centres[0]) + distance(next[1], centres[1]);
    centres = next;
    if (moved < 0.5) break;
  }
  const counts = [0, 0];
  for (const which of side) counts[which]!++;
  return { cells, side, centres, counts };
}

/** The share of a tone's cells that touch a cell that is not ink (the grid's own edge counts as not ink). */
function onEdge(read: InkRead, cells: readonly number[], side: Uint8Array, which: number): number {
  const { grid, ink } = read;
  let own = 0;
  let touching = 0;
  cells.forEach((index, at) => {
    if (side[at] !== which) return;
    own++;
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    const open =
      x === 0 ||
      y === 0 ||
      x === grid.width - 1 ||
      y === grid.height - 1 ||
      ink[index - 1] !== 1 ||
      ink[index + 1] !== 1 ||
      ink[index - grid.width] !== 1 ||
      ink[index + grid.width] !== 1;
    if (open) touching++;
  });
  return own === 0 ? 1 : touching / own;
}

/**
 * The quarter of the colours farthest from `from` (the strokes' cores, not their soft edges), as readInk takes a
 * shape's ink: a tone's colour is this, not the blend with what lies beside it.
 */
function coreColour(colours: readonly Rgb[], from: Rgb): Rgb {
  const farthest = [...colours].sort((a, b) => distance(b, from) - distance(a, from));
  return medianColour(farthest.slice(0, Math.max(2, Math.ceil(farthest.length / 4))));
}

/**
 * The ink's tones: letters and, when one tone wraps the other, their outline. `rarer`: of two tones that both reach
 * the picture, read the rarer one (the caller asks when the commoner one turned out not to be letters).
 */
export function readTones(settled: Settled, read: InkRead, rarer = false): Tones {
  const { grid, ink } = read;
  const labels = new Uint8Array(ink.length);
  const one = (
    mixed: boolean,
    keep?: { cells: readonly number[]; side: Uint8Array; which: number },
  ): Tones => {
    if (keep) keep.cells.forEach((index, at) => (labels[index] = keep.side[at] === keep.which ? LETTERS : 0));
    else for (let index = 0; index < ink.length; index++) labels[index] = ink[index] === 1 ? LETTERS : 0;
    const letters = coreColour(coloursOf(settled, grid, labels, LETTERS), read.behind);
    return { labels, letters, outline: null, mixed };
  };
  const { cells, side, centres, counts } = twoTones(settled, read);
  const apart = distance(centres[0], centres[1]);
  const least = Math.min(counts[0]!, counts[1]!) / Math.max(1, cells.length);
  if (apart < TYPE_INK.tonesApart || least < TYPE_INK.toneShare) return one(false);
  const edges = [onEdge(read, cells, side, 0), onEdge(read, cells, side, 1)];
  const outer = edges[0]! >= edges[1]! ? 0 : 1;
  const inner = 1 - outer;
  if (edges[inner]! > TYPE_INK.lettersOnEdge || edges[outer]! < edges[inner]! + TYPE_INK.outlineOnEdge) {
    // Both tones reach the picture: words in two colours, a hard shadow, a still patch beside them. One is read.
    const common = counts[0]! >= counts[1]! ? 0 : 1;
    return one(true, { cells, side, which: rarer ? 1 - common : common });
  }
  cells.forEach((index, at) => (labels[index] = side[at] === inner ? LETTERS : OUTLINE));
  // Each tone's colour is what is farthest from the other: between them the copy's softness mixes the two.
  const letters = coreColour(coloursOf(settled, grid, labels, LETTERS), centres[outer]!);
  const outline = coreColour(coloursOf(settled, grid, labels, OUTLINE), letters);
  return { labels, letters, outline, mixed: false };
}

/** How still the cells with `label` are: their median spread over the frames. */
export function restOf(settled: Settled, grid: Grid, labels: Uint8Array, label: number): number {
  const spreads: number[] = [];
  for (let index = 0; index < labels.length; index++) {
    if (labels[index] !== label) continue;
    const x = grid.rect.left + (index % grid.width);
    const y = grid.rect.top + Math.floor(index / grid.width);
    spreads.push(settled.spread[y * settled.median.width + x]!);
  }
  spreads.sort((a, b) => a - b);
  return spreads[Math.floor((spreads.length - 1) / 2)] ?? 0;
}

/**
 * The outline tone given up. `softEdge`: it was the letters' own soft edge, so its cells nearer the letters'
 * colour than what lies behind stay letters; otherwise (a still patch, a still shadow) none of it is letters.
 * `mixed`: it was a tone of its own beside the letters, which makes the reading less sure.
 */
export function withoutOutline(
  settled: Settled,
  read: InkRead,
  tones: Tones,
  given: { softEdge: boolean; mixed: boolean },
): Tones {
  const { grid, behind } = read;
  const labels = new Uint8Array(tones.labels);
  for (let index = 0; index < labels.length; index++) {
    if (labels[index] !== OUTLINE) continue;
    const x = grid.rect.left + (index % grid.width);
    const y = grid.rect.top + Math.floor(index / grid.width);
    const colour = pixel(settled.median, x, y);
    const letter = given.softEdge && distance(colour, tones.letters) < distance(colour, behind);
    labels[index] = letter ? LETTERS : 0;
  }
  return { labels, letters: tones.letters, outline: null, mixed: given.mixed };
}
