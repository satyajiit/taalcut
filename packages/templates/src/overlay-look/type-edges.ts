// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: the soft edges of an overlay's strokes. The breakdown's copy of a reel is scaled and encoded, so the last
 * cell of a stroke is part stroke, part what lies beside it: over a moving picture such a cell moves and is not
 * ink at all, so strokes read thin by up to a cell a side, and a stem of three cells is a weight or two off.
 *
 * How much of a cell a tone covers is its colour's place on the line from what lies beside the stroke (the picture
 * a few cells further out, or the other tone) to the tone's own colour. With that, a cell that is mostly stroke
 * joins the stroke (`grownLabels`), and a run's length is told to a fraction of a cell (`edgesOf`). It also tells
 * a tone that fades through its width (a shadow that is still because the picture is) from an outline, which is
 * one colour (`fades`). Pure.
 */
import { pixel, type Rgb } from './pixels';
import { STILL, type Settled } from './shape';
import { LETTERS, OUTLINE, type Grid, type Tones } from './type-ink';

export const TYPE_EDGES = {
  /** Two colours nearer than this (RGB) can't say how much of a cell either covers. */
  contrast: 60,
  /** A cell further than this (RGB) from every mix of the two is something else: it says nothing either. */
  offLine: 64,
  /** A cell joins a stroke when the stroke's colour covers this much of it. */
  half: 0.5,
  /** A stroke's soft edge is at most this many cells; the picture beside it is the two cells past that. */
  softCells: 2,
  /** Over a moving picture a cell that joins a stroke moves at most this share of what the picture does. */
  stiller: 0.75,
  /**
   * An outline is one colour through its width, bar the copy's softness at its edges (two cells at most). A tone
   * with this many cells a run, past the one against the letters, that it covers by `faint` to `core` fades: a
   * shadow. Against a known colour the fade is followed `fadePast` cells past where the tone stops being ink.
   */
  fadeCells: 3,
  faint: 0.15,
  core: 0.75,
  fadePast: 4,
} as const;

/** How much longer than its cells a run of `label` is: along row (or column) `line`, from cell `from` to `to`. */
export type Adjust = (line: number, from: number, to: number, alongRow: boolean, label: number) => number;

/**
 * The share of a cell of `colour` that `tone` covers, the rest being `other`: its place along the line from one
 * to the other, as it falls (under 0 or over 1 with the picture's grain). Null when the two can't be told apart or
 * the colour is neither.
 */
function cover(colour: Rgb, tone: Rgb, other: Rgb): number | null {
  const span = [tone[0] - other[0], tone[1] - other[1], tone[2] - other[2]] as const;
  const length = span[0] * span[0] + span[1] * span[1] + span[2] * span[2];
  if (length < TYPE_EDGES.contrast * TYPE_EDGES.contrast) return null;
  const from = [colour[0] - other[0], colour[1] - other[1], colour[2] - other[2]] as const;
  const along = (from[0] * span[0] + from[1] * span[1] + from[2] * span[2]) / length;
  const off = Math.hypot(from[0] - along * span[0], from[1] - along * span[1], from[2] - along * span[2]);
  return off > TYPE_EDGES.offLine ? null : along;
}

const within = (value: number, least: number, most: number) => Math.min(most, Math.max(least, value));

/** What lies past the end of a run, cell by cell outward, and the picture the run's soft edge mixes with. */
function sideOf(settled: Settled, grid: Grid, labels: Uint8Array, tones: Tones) {
  const colourAt = (x: number, y: number) => pixel(settled.median, grid.rect.left + x, grid.rect.top + y);
  const restAt = (x: number, y: number) =>
    settled.spread[(grid.rect.top + y) * settled.median.width + grid.rect.left + x]!;
  const labelAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= grid.width || y >= grid.height ? -1 : labels[y * grid.width + x]!;
  const toneOf = (label: number) => (label === OUTLINE ? tones.outline : tones.letters);
  /**
   * From the run's last cell (x, y) outward by (dx, dy): up to `soft` cells of soft edge, then the picture beside
   * the run (the next two cells' mean colour, and how much they move). Fewer cells of soft edge when another
   * stroke is in the way. Where the run touches the other tone, that tone's colour and the one cell against it
   * (`tones`; the two were split at the nearer colour, so that cell holds under half). Null when nothing can be
   * told.
   */
  const beside = (x: number, y: number, dx: number, dy: number, soft: number, tones = false) => {
    const next = labelAt(x + dx, y + dy);
    if (next > 0) {
      const other = tones ? toneOf(next) : null;
      return other ? { other, soft: 1, rest: 0 } : null;
    }
    let clear = 0;
    while (clear < soft + 2 && labelAt(x + dx * (clear + 1), y + dy * (clear + 1)) === 0) clear++;
    const edge = Math.min(soft, clear - 1);
    if (edge < 1) return null;
    const sum = [0, 0, 0];
    let rest = 0;
    for (let out = edge + 1; out <= clear; out++) {
      const colour = colourAt(x + dx * out, y + dy * out);
      sum[0]! += colour[0];
      sum[1]! += colour[1];
      sum[2]! += colour[2];
      rest += restAt(x + dx * out, y + dy * out);
    }
    const cells = clear - edge;
    const other: Rgb = [sum[0]! / cells, sum[1]! / cells, sum[2]! / cells];
    return { other, soft: edge, rest: rest / cells };
  };
  return { colourAt, restAt, labelAt, toneOf, beside };
}

/**
 * The labels with each stroke's soft edge joined to it: a cell beside a stroke that the stroke's colour covers by
 * half or more and, over a picture that moves, that moves less than the picture does. Cells are judged against
 * the labels given, so the order they are met in changes nothing.
 */
export function grownLabels(settled: Settled, grid: Grid, tones: Tones): Uint8Array {
  const labels = tones.labels;
  const { colourAt, restAt, labelAt, toneOf, beside } = sideOf(settled, grid, labels, tones);
  const grown = new Uint8Array(labels);
  const steps = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const label = labels[y * grid.width + x]!;
      if (label === 0) continue;
      const tone = toneOf(label);
      if (!tone) continue;
      for (const [dx, dy] of steps) {
        if (labelAt(x + dx, y + dy) !== 0) continue;
        const side = beside(x, y, dx, dy, TYPE_EDGES.softCells);
        if (!side) continue;
        for (let step = 1; step <= side.soft; step++) {
          const cx = x + dx * step;
          const cy = y + dy * step;
          const share = cover(colourAt(cx, cy), tone, side.other);
          if (share === null || share < TYPE_EDGES.half) break;
          if (side.rest > STILL && restAt(cx, cy) > side.rest * TYPE_EDGES.stiller) break;
          // An outline's edge wins a cell both tones reach for: the letters lie inside it.
          if (grown[cy * grid.width + cx] === 0 || label === OUTLINE) grown[cy * grid.width + cx] = label;
        }
      }
    }
  return grown;
}

/**
 * Runs told to a fraction of a cell: what each end's own cell and the cell past it really hold of the tone (the
 * labels are the grown ones, so the cell past an end holds under half). `shadowed`: a shadow darkens the picture
 * toward the letters, so the cell past a run may read under nothing; there nothing is the least. Elsewhere it may,
 * by as much as it may read over, so the picture's grain adds as much as it takes away. Between letters and their
 * outline the same holds of the two tones; an outline so narrow that no cell of it is its own colour reads a
 * little toward the letters there, and the letters a little thin.
 */
export function edgesOf(
  settled: Settled,
  grid: Grid,
  labels: Uint8Array,
  tones: Tones,
  shadowed: boolean,
): Adjust {
  const { colourAt, toneOf, beside } = sideOf(settled, grid, labels, tones);
  return (line, from, to, alongRow, label) => {
    const tone = toneOf(label);
    if (!tone) return 0;
    /** One end: how much of its own cell the tone holds, and how much of the cell past it. */
    const end = (at: number, step: number): { own: number; past: number } => {
      const x = alongRow ? at : line;
      const y = alongRow ? line : at;
      const dx = alongRow ? step : 0;
      const dy = alongRow ? 0 : step;
      const side = beside(x, y, dx, dy, 1, true);
      if (!side) return { own: 1, past: 0 };
      const past = cover(colourAt(x + dx, y + dy), tone, side.other) ?? 0;
      const own = cover(colourAt(x, y), tone, side.other) ?? 1;
      return { own: within(own, 0, 1), past: within(past, shadowed ? 0 : -TYPE_EDGES.half, TYPE_EDGES.half) };
    };
    const first = end(from, -1);
    const last = end(to, 1);
    // A run of one cell is one cell seen from both sides.
    const own = from === to ? (first.own + last.own) / 2 - 1 : first.own - 1 + (last.own - 1);
    return own + first.past + last.past;
  };
}

/**
 * Each cell's distance from the nearest cell `from` picks, counted in cells along rows, columns or diagonals
 * (two sweeps).
 */
export function distanceFrom(labels: Uint8Array, grid: Grid, from: (label: number) => boolean): Uint16Array {
  const far = grid.width + grid.height;
  const reach = new Uint16Array(labels.length);
  for (let index = 0; index < labels.length; index++) reach[index] = from(labels[index]!) ? 0 : far;
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= grid.width || y >= grid.height ? far : reach[y * grid.width + x]!;
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const near = Math.min(at(x - 1, y), at(x, y - 1), at(x - 1, y - 1), at(x + 1, y - 1)) + 1;
      if (near < reach[y * grid.width + x]!) reach[y * grid.width + x] = near;
    }
  for (let y = grid.height - 1; y >= 0; y--)
    for (let x = grid.width - 1; x >= 0; x--) {
      const near = Math.min(at(x + 1, y), at(x, y + 1), at(x + 1, y + 1), at(x - 1, y + 1)) + 1;
      if (near < reach[y * grid.width + x]!) reach[y * grid.width + x] = near;
    }
  return reach;
}

/** Every run of `label` along the grid's rows (or down its columns) within [from, to) of the other axis. */
export function* runsOf(
  labels: Uint8Array,
  grid: Grid,
  alongRow: boolean,
  from: number,
  to: number,
  label: number,
) {
  const at = (line: number, step: number) => (alongRow ? line * grid.width + step : step * grid.width + line);
  const lines = alongRow ? [from, to] : [0, grid.width];
  const steps = alongRow ? [0, grid.width] : [from, to];
  for (let line = lines[0]!; line < lines[1]!; line++) {
    let start = -1;
    for (let step = steps[0]!; step <= steps[1]!; step++) {
      const inside = step < steps[1]! && labels[at(line, step)] === label;
      if (inside && start < 0) start = step;
      if (!inside && start >= 0) {
        yield { line, from: start, to: step - 1 };
        start = -1;
      }
    }
  }
}

/**
 * The outline's runs from the letters out to the picture, along rows and columns: each run's cells in that order,
 * as grid coordinates, and the cells past it (`fadePast` of them).
 */
export function* outlineRuns(labels: Uint8Array, grid: Grid) {
  const labelAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= grid.width || y >= grid.height ? 0 : labels[y * grid.width + x]!;
  for (const alongRow of [true, false])
    for (const run of runsOf(labels, grid, alongRow, 0, grid.height, OUTLINE)) {
      const cell = (step: number) => (alongRow ? ([step, run.line] as const) : ([run.line, step] as const));
      const before = labelAt(...cell(run.from - 1));
      const after = labelAt(...cell(run.to + 1));
      const outward = before === LETTERS && after === 0 ? 1 : before === 0 && after === LETTERS ? -1 : 0;
      if (outward === 0) continue;
      const first = outward === 1 ? run.from : run.to;
      const last = outward === 1 ? run.to : run.from;
      const cells = Array.from({ length: run.to - run.from + 1 }, (_, index) =>
        cell(first + outward * index),
      );
      const past = Array.from({ length: TYPE_EDGES.fadePast }, (_, index) =>
        cell(last + outward * (index + 1)),
      );
      yield { ...run, alongRow, cells, past };
    }
}

/**
 * Whether the outline tone fades through its width: most of its runs hold `fadeCells` cells or more, past the one
 * against the letters, that are neither its own colour nor yet what lies behind. A shadow on a still picture is
 * still, so it reads as a second tone round the letters; an outline is one colour. `background` is the colour
 * behind when it is known (the fade is followed into it); else the picture two cells past the run stands for it.
 */
export function fades(
  settled: Settled,
  grid: Grid,
  labels: Uint8Array,
  tones: Tones,
  background: Rgb | null,
): boolean {
  const tone = tones.outline;
  if (!tone) return false;
  const colourAt = (x: number, y: number) => pixel(settled.median, grid.rect.left + x, grid.rect.top + y);
  const clear = ([x, y]: readonly [number, number]) =>
    x >= 0 && y >= 0 && x < grid.width && y < grid.height && labels[y * grid.width + x] === 0;
  const faint: number[] = [];
  for (const run of outlineRuns(labels, grid)) {
    let past = 0;
    while (past < run.past.length && clear(run.past[past]!)) past++;
    if (!background && past < 2) continue;
    const behind = background ?? colourAt(...run.past[1]!);
    const cells = [...run.cells.slice(1), ...run.past.slice(0, background ? past : 1)];
    let count = 0;
    for (const [x, y] of cells) {
      const share = cover(colourAt(x, y), tone, behind);
      if (share !== null && share >= TYPE_EDGES.faint && share < TYPE_EDGES.core) count++;
    }
    faint.push(count);
  }
  if (faint.length < 6) return false;
  faint.sort((a, b) => a - b);
  return faint[Math.floor((faint.length - 1) / 2)]! >= TYPE_EDGES.fadeCells;
}
