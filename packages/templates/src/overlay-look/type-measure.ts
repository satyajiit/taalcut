// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: the letters' measures from their cells (type-ink.ts, type-edges.ts): each letter's own box, the lines the
 * boxes stand on and the letters' height, the strokes' thickness across (stems) and along (bars), the outline's
 * width, how wide the letters are set and how far apart, and whether the picture just outside them is darker than
 * further out (a shadow). Pure; lengths are pixels of the region image.
 */
import type { RegionImage } from './pixels';
import { distanceFrom, outlineRuns, runsOf, type Adjust } from './type-edges';
import { LETTERS, OUTLINE, type Grid } from './type-ink';

export const TYPE_MEASURE = {
  /** A box under this share of the usual box's height is a mark (a dot, a comma, an accent), not a letter. */
  markShare: 0.4,
  /** A box stands on a line it overlaps by this share of the lower of the two. */
  lineOverlap: 0.5,
  /**
   * The baseline is the last row with this share of its line's fullest row: descenders are sparser than that, and
   * at most `descender` of the line. A sparser foot than that is stems (TY), not descenders, and is kept.
   */
  denseShare: 0.35,
  descender: 0.35,
  /** A line under this share of the tallest line is left out. */
  lineShare: 0.5,
  /** A run across a stroke is at most this share of the letters' height; a longer one lies along a bar. */
  strokeShare: 0.6,
  /** Runs up to this many times the lower quartile are strokes; longer ones cross a bar, an arc or two letters. */
  strokeSpread: 1.8,
  /** Fewer runs than this say nothing. */
  minRuns: 6,
  /** One letter's box is between these widths, for the letters' height: narrower is an I, wider is joined letters. */
  letterNarrow: 0.25,
  letterWide: 1.6,
  /**
   * A box under this share of the letters' height is a short letter (x-height): its width over its own height,
   * times `shortWidth`, compares with a tall letter's width over the letters' height (a round o is as wide as it
   * is tall in a face whose capitals are four fifths as wide as tall).
   */
  shortLetter: 0.85,
  shortWidth: 0.82,
  /** A gap up to this many times the lower quartile is between letters; a wider one is between words. */
  gapSpread: 1.8,
  /** The picture's first cells past the ink are its soft edge, not a shadow. */
  shadowSkip: 2,
  /** A shadow's band past that, as a share of the letters' height; the picture it is compared with is three on. */
  shadowBand: 0.15,
  /** A shadow darkens the band by this share of the picture's brightness, and by this much, in most frames. */
  shadowShare: 0.12,
  shadowLuma: 12,
  shadowFrames: 0.8,
  /** Darker than this, a picture hides a shadow. */
  shadowFloor: 45,
} as const;

/** A connected group of letter cells: its box (right and bottom are one past) and how many cells it holds. */
export interface Box {
  /** The group's number in `letterBoxes`' `ids`. */
  readonly id: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly cells: number;
}

/** A line of letters: its first row, the row after its baseline, the row after its lowest descender, its letters. */
export interface Line {
  readonly top: number;
  readonly baseline: number;
  readonly bottom: number;
  readonly boxes: readonly Box[];
}

/** The mean of the middle half of `values` (a median that tells fractions of a pixel apart); null when empty. */
export function middleMean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const from = Math.floor(sorted.length / 4);
  const to = Math.max(from + 1, Math.ceil((sorted.length * 3) / 4));
  let sum = 0;
  for (let index = from; index < to; index++) sum += sorted[index]!;
  return sum / (to - from);
}

const quartile = (values: readonly number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 4)] ?? 0;

/**
 * Each connected group of letter cells (touching corners join) of three cells or more, as its box; `ids` holds
 * each letter cell's group number (from 1).
 */
export function letterBoxes(labels: Uint8Array, grid: Grid): { boxes: Box[]; ids: Int32Array } {
  const ids = new Int32Array(labels.length);
  const boxes: Box[] = [];
  const stack: number[] = [];
  let id = 0;
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== LETTERS || ids[start] !== 0) continue;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    let cells = 0;
    id++;
    ids[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % grid.width;
      const y = Math.floor(index / grid.width);
      cells++;
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
          const next = ny * grid.width + nx;
          if (labels[next] !== LETTERS || ids[next] !== 0) continue;
          ids[next] = id;
          stack.push(next);
        }
    }
    if (cells >= 3) boxes.push({ id, left, top, right, bottom, cells });
  }
  return { boxes, ids };
}

/**
 * The labels with only the lines' letters as letters: specks of the picture that happened to be still, and marks
 * (dots, commas), say nothing of the strokes and would count as the thinnest of them.
 */
export function lettersOnly(labels: Uint8Array, ids: Int32Array, lines: readonly Line[]): Uint8Array {
  const kept = new Set(lines.flatMap((line) => line.boxes.map((box) => box.id)));
  const only = new Uint8Array(labels);
  for (let index = 0; index < only.length; index++)
    if (only[index] === LETTERS && !kept.has(ids[index]!)) only[index] = 0;
  return only;
}

/**
 * The lines the letters stand on, top to bottom, and the letters' height: the top of a line's tallest letter to
 * its baseline, the median line's. Lines are told from the letters' own boxes, so two lines set tight are two.
 */
export function linesOf(
  labels: Uint8Array,
  grid: Grid,
  boxes: readonly Box[],
): { lines: Line[]; height: number } | null {
  if (boxes.length === 0) return null;
  // The usual box's height, each box counting for its cells: the letters hold the ink, the marks hardly any.
  const byHeight = [...boxes].sort((a, b) => a.bottom - a.top - (b.bottom - b.top));
  const half = byHeight.reduce((sum, box) => sum + box.cells, 0) / 2;
  let usual = byHeight[0]!;
  let counted = 0;
  for (const box of byHeight) {
    usual = box;
    counted += box.cells;
    if (counted >= half) break;
  }
  const least = (usual.bottom - usual.top) * TYPE_MEASURE.markShare;
  const letters = boxes.filter((box) => box.bottom - box.top >= least).sort((a, b) => a.top - b.top);

  const groups: { top: number; bottom: number; boxes: Box[] }[] = [];
  for (const box of letters) {
    const group = groups.find((line) => {
      const shared = Math.min(line.bottom, box.bottom) - Math.max(line.top, box.top);
      return shared >= TYPE_MEASURE.lineOverlap * Math.min(line.bottom - line.top, box.bottom - box.top);
    });
    if (!group) {
      groups.push({ top: box.top, bottom: box.bottom, boxes: [box] });
      continue;
    }
    group.top = Math.min(group.top, box.top);
    group.bottom = Math.max(group.bottom, box.bottom);
    group.boxes.push(box);
  }
  const rows = new Array<number>(grid.height).fill(0);
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) if (labels[y * grid.width + x] === LETTERS) rows[y]!++;
  const lines = groups.map((group): Line => {
    let fullest = 0;
    for (let y = group.top; y < group.bottom; y++) fullest = Math.max(fullest, rows[y]!);
    const sparse = (y: number) => rows[y]! < fullest * TYPE_MEASURE.denseShare;
    const highest = group.bottom - Math.floor((group.bottom - group.top) * TYPE_MEASURE.descender);
    let baseline = group.bottom;
    while (baseline > highest && sparse(baseline - 1)) baseline--;
    if (baseline === highest && sparse(baseline - 1)) baseline = group.bottom;
    return { top: group.top, baseline, bottom: group.bottom, boxes: group.boxes };
  });
  const tallest = Math.max(...lines.map((line) => line.baseline - line.top));
  const kept = lines
    .filter((line) => line.baseline - line.top >= tallest * TYPE_MEASURE.lineShare)
    .sort((a, b) => a.top - b.top);
  const heights = kept.map((line) => line.baseline - line.top).sort((a, b) => a - b);
  return { lines: kept, height: heights[Math.floor((heights.length - 1) / 2)]! };
}

/** The strokes among `runs`: the runs near the lower quartile, as one thickness. */
function strokeOf(runs: readonly number[]): { size: number; runs: number } | null {
  if (runs.length < TYPE_MEASURE.minRuns) return null;
  const most = quartile(runs) * TYPE_MEASURE.strokeSpread + 1;
  const strokes = runs.filter((run) => run <= most);
  const size = middleMean(strokes);
  return size === null ? null : { size, runs: strokes.length };
}

/**
 * The letters' strokes: `stem` from runs along the rows (upright strokes cut across), `bar` from runs down the
 * columns (level strokes cut across). Runs longer than `strokeShare` of the height lie along a stroke and are
 * left. `adjust` tells each run's length to a fraction of a cell (type-edges.ts).
 */
export function strokesOf(
  labels: Uint8Array,
  grid: Grid,
  lines: readonly Line[],
  height: number,
  adjust?: Adjust,
) {
  const longest = height * TYPE_MEASURE.strokeShare;
  const across: number[] = [];
  const down: number[] = [];
  for (const line of lines)
    for (const alongRow of [true, false])
      for (const run of runsOf(labels, grid, alongRow, line.top, line.baseline, LETTERS)) {
        const cells = run.to - run.from + 1;
        if (cells > longest) continue;
        const more = adjust ? adjust(run.line, run.from, run.to, alongRow, LETTERS) : 0;
        (alongRow ? across : down).push(Math.max(0.5, cells + more));
      }
  return { stem: strokeOf(across), bar: strokeOf(down) };
}

/**
 * The letters' height to a fraction of a pixel: the upright strokes that run a line's whole height, its top to its
 * baseline (the stems of H, L, E, b, d), each told by `adjust`; the median line's. The taller half of them say it
 * (its median): down a stem's soft side every cell is part picture, and the run reads short. A line with too few
 * of them (round letters, a script) keeps the rows it counted.
 */
export function tallOf(labels: Uint8Array, grid: Grid, lines: readonly Line[], adjust: Adjust): number {
  const heights = lines.map((line) => {
    const lengths: number[] = [];
    for (const run of runsOf(labels, grid, false, line.top, line.bottom, LETTERS)) {
      if (run.from > line.top + 1 || run.to < line.baseline - 2 || run.to > line.baseline) continue;
      lengths.push(run.to - run.from + 1 + adjust(run.line, run.from, run.to, false, LETTERS));
    }
    if (lengths.length < TYPE_MEASURE.minRuns) return line.baseline - line.top;
    lengths.sort((a, b) => b - a);
    return lengths[Math.floor(lengths.length / 4)]!;
  });
  heights.sort((a, b) => a - b);
  return heights[Math.floor((heights.length - 1) / 2)] ?? 0;
}

/** The outline's width: its runs with the letters on one side and the picture on the other, along rows and columns. */
export function outlineWidth(labels: Uint8Array, grid: Grid, adjust?: Adjust): number | null {
  const widths: number[] = [];
  for (const run of outlineRuns(labels, grid)) {
    const more = adjust ? adjust(run.line, run.from, run.to, run.alongRow, OUTLINE) : 0;
    widths.push(Math.max(0.5, run.to - run.from + 1 + more));
  }
  return widths.length < TYPE_MEASURE.minRuns ? null : middleMean(widths);
}

/**
 * How wide the letters are set (a letter's box width over the letters' height, the median letter's; a short
 * letter's over its own height, scaled) and the gap between neighbours on a line; `letters` counts the boxes that
 * read as one letter each.
 */
export function setOf(lines: readonly Line[]) {
  const ratios: number[] = [];
  const gaps: number[] = [];
  for (const line of lines) {
    const tall = line.baseline - line.top;
    for (const box of line.boxes) {
      const width = box.right - box.left;
      if (width < tall * TYPE_MEASURE.letterNarrow || width > tall * TYPE_MEASURE.letterWide) continue;
      const own = box.bottom - box.top;
      ratios.push(
        own >= tall * TYPE_MEASURE.shortLetter ? width / tall : (width / own) * TYPE_MEASURE.shortWidth,
      );
    }
    const inOrder = [...line.boxes].sort((a, b) => a.left - b.left);
    for (let index = 1; index < inOrder.length; index++)
      gaps.push(Math.max(0, inOrder[index]!.left - inOrder[index - 1]!.right));
  }
  ratios.sort((a, b) => a - b);
  const between = gaps.filter((gap) => gap <= quartile(gaps) * TYPE_MEASURE.gapSpread + 1);
  return {
    ratio: ratios.length === 0 ? null : ratios[Math.floor((ratios.length - 1) / 2)]!,
    gap: gaps.length === 0 ? null : middleMean(between),
    letters: ratios.length,
  };
}

/**
 * Whether a dark soft edge lies under or round the letters: in most frames the picture in a band just past the ink
 * is darker than the picture a few bands further out. Read from the frames themselves, since a shadow moves with
 * the picture under it and is never still. It can't see a shadow on a picture as dark as the shadow, or a hard
 * shadow drawn as a solid copy of the letters (that is still: a second tone beside the letters, not round them).
 * A dark see-through box behind the words reads as a shadow too.
 */
export function hasShadow(
  frames: readonly RegionImage[],
  labels: Uint8Array,
  grid: Grid,
  height: number,
): boolean {
  const reach = distanceFrom(labels, grid, (label) => label !== 0);
  const band = Math.max(2, Math.round(height * TYPE_MEASURE.shadowBand));
  const skip = TYPE_MEASURE.shadowSkip;
  const nearCells: number[] = [];
  const farCells: number[] = [];
  for (let index = 0; index < reach.length; index++) {
    const distance = reach[index]!;
    if (distance > skip && distance <= skip + band) nearCells.push(index);
    else if (distance > skip + 3 * band && distance <= skip + 4 * band) farCells.push(index);
  }
  if (nearCells.length < 12 || farCells.length < 12 || frames.length === 0) return false;
  const luma = (image: RegionImage, cells: readonly number[]) => {
    let sum = 0;
    for (const index of cells) {
      const x = grid.rect.left + (index % grid.width);
      const y = grid.rect.top + Math.floor(index / grid.width);
      const from = (y * image.width + x) * 3;
      sum += 0.299 * image.rgb[from]! + 0.587 * image.rgb[from + 1]! + 0.114 * image.rgb[from + 2]!;
    }
    return sum / cells.length;
  };
  let darker = 0;
  const beyond: number[] = [];
  for (const image of frames) {
    const outside = luma(image, farCells);
    const drop = outside - luma(image, nearCells);
    beyond.push(outside);
    if (drop >= Math.max(TYPE_MEASURE.shadowLuma, outside * TYPE_MEASURE.shadowShare)) darker++;
  }
  const picture = middleMean(beyond) ?? 0;
  return picture >= TYPE_MEASURE.shadowFloor && darker / frames.length >= TYPE_MEASURE.shadowFrames;
}
