// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The reel inside a screen recording (templates SPEC, "File or screen recording"): the rectangle that moves,
 * inside the part of the frame that is ever lit. FFmpeg's `cropdetect` is GPL-only and the sidecar is LGPL,
 * so the breakdown reads small gray frames from media's `sampleFrames` (one decode, VideoToolbox first, the
 * same upright frame `conform` crops) and does the arithmetic here:
 *
 * - a pixel moved when its luma changed by more than `motion` between two samples (a cut changes every pixel
 *   of the reel, so one cut is enough to show the whole rectangle);
 * - the moving region is the heaviest band of rows with moving pixels, then the heaviest band of columns
 *   inside it, bridging small gaps, so a status-bar clock that ticks once doesn't stretch the box;
 * - the lit region is the box of pixels brighter than `black` in any sample (render QA's `bbox=min_val=24`),
 *   so letterbox bars never count.
 *
 * No crop (null) when nothing moved, when the box is nearly the whole frame, or when it is too small to be a
 * reel (a spinner). Known limit: a single shot where only part of the reel ever moves gives that part.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import {
  fileParams,
  sampleFrames,
  UnsupportedMedia,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';

export const CROP_SCAN = {
  /** Samples a second and the analysis frame's long side. */
  fps: 2,
  longSide: 320,
  /** 8-bit luma steps: a pixel moved between two samples when it changed by more than this. */
  motion: 24,
  /** Luma at or below this is black (render QA's bbox `min_val`). */
  black: 24,
  /** A row or column belongs to the moving region when at least this share of its pixels moved. */
  activeShare: 0.02,
  /** Gaps inside the moving region up to this share of the side are bridged. */
  gapShare: 0.02,
  /** No crop when the box covers at least this share of both sides. */
  wholeShare: 0.95,
  /** No crop when the box is under this share of either side: too small to be the reel. */
  minShare: 0.25,
} as const;

export type CropTuning = typeof CROP_SCAN;

/** A rectangle; `x` and `y` are its first column and row. */
export interface PixelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Span {
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
}

/** The band of indexes at or over `threshold` with the most weight, bridging gaps up to `gap` long. */
export function heaviestRun(weights: ArrayLike<number>, threshold: number, gap: number): Span | null {
  const runs: { start: number; end: number; weight: number }[] = [];
  for (let index = 0; index < weights.length; index++) {
    const weight = weights[index] ?? 0;
    if (weight < threshold) continue;
    const last = runs.at(-1);
    if (last && index - last.end <= gap) {
      last.end = index + 1;
      last.weight += weight;
    } else runs.push({ start: index, end: index + 1, weight });
  }
  let best = runs[0];
  for (const run of runs) if (best && run.weight > best.weight) best = run;
  return best ? { start: best.start, end: best.end } : null;
}

function intersect(a: PixelBox, b: PixelBox): PixelBox | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** One byte per pixel, row by row. */
interface Plane {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** Set (non-zero) pixels per row, or per column over the rows of `band`. */
function sums(
  plane: Plane,
  along: 'rows' | 'columns',
  band: Span = { start: 0, end: plane.height },
): Uint32Array {
  const out = new Uint32Array(along === 'rows' ? plane.height : plane.width);
  for (let y = band.start; y < band.end; y++)
    for (let x = 0; x < plane.width; x++) {
      if ((plane.data[y * plane.width + x] ?? 0) === 0) continue;
      const at = along === 'rows' ? y : x;
      out[at] = (out[at] ?? 0) + 1;
    }
  return out;
}

/** The heaviest band of rows with moved pixels, then the heaviest band of columns inside it. */
function movingBox(moved: Plane, tuning: CropTuning): PixelBox | null {
  const rowsGap = Math.round(tuning.gapShare * moved.height);
  const band = heaviestRun(sums(moved, 'rows'), Math.max(1, tuning.activeShare * moved.width), rowsGap);
  if (!band) return null;
  const tall = band.end - band.start;
  const columnsGap = Math.round(tuning.gapShare * moved.width);
  const across = heaviestRun(
    sums(moved, 'columns', band),
    Math.max(1, tuning.activeShare * tall),
    columnsGap,
  );
  if (!across) return null;
  return { x: across.start, y: band.start, width: across.end - across.start, height: tall };
}

/** The box of every pixel set in `lit` (FFmpeg's bbox), or null when none is. */
function boundingBox(lit: Plane): PixelBox | null {
  const rows = heaviestRun(sums(lit, 'rows'), 1, lit.height);
  const columns = heaviestRun(sums(lit, 'columns'), 1, lit.width);
  if (!rows || !columns) return null;
  return {
    x: columns.start,
    y: rows.start,
    width: columns.end - columns.start,
    height: rows.end - rows.start,
  };
}

/** The found box, unless it is nearly the whole frame or too small to be a reel. */
function judged(found: PixelBox | null, frame: Plane, tuning: CropTuning): PixelBox | null {
  if (!found) return null;
  const { width, height } = frame;
  if (found.width < tuning.minShare * width || found.height < tuning.minShare * height) return null;
  return found.width >= tuning.wholeShare * width && found.height >= tuning.wholeShare * height
    ? null
    : found;
}

export interface CropScan {
  /** One gray frame of `width × height` bytes; false (and ignored) when its size is wrong. */
  add(data: Uint8Array): boolean;
  /** The reel in analysis pixels, or null for the whole frame. */
  box(): PixelBox | null;
}

export function createCropScan(width: number, height: number, tuning: CropTuning = CROP_SCAN): CropScan {
  const moved: Plane = { data: new Uint8Array(width * height), width, height };
  const lit: Plane = { data: new Uint8Array(width * height), width, height };
  let previous: Uint8Array | undefined;
  return {
    add(data) {
      if (data.length !== width * height) return false;
      data.forEach((value, index) => {
        if (value > tuning.black) lit.data[index] = 1;
        if (previous && Math.abs(value - (previous[index] ?? 0)) > tuning.motion) moved.data[index] = 1;
      });
      previous = data;
      return true;
    },
    box() {
      const moving = movingBox(moved, tuning);
      const bright = boundingBox(lit);
      return judged(moving && bright ? intersect(moving, bright) : null, moved, tuning);
    },
  };
}

const toEven = (value: number) => 2 * Math.round(value / 2);

/** `box` on an analysis frame scaled up to the source frame: even pixels, inside the frame. */
export function toSourceBox(
  box: PixelBox,
  analysis: { readonly width: number; readonly height: number },
  source: { readonly width: number; readonly height: number },
): PixelBox {
  const sx = source.width / analysis.width;
  const sy = source.height / analysis.height;
  const maxX = source.width - (source.width % 2);
  const maxY = source.height - (source.height % 2);
  const x = Math.min(maxX - 2, Math.max(0, toEven(box.x * sx)));
  const y = Math.min(maxY - 2, Math.max(0, toEven(box.y * sy)));
  const right = Math.max(x + 2, Math.min(maxX, toEven((box.x + box.width) * sx)));
  const bottom = Math.max(y + 2, Math.min(maxY, toEven((box.y + box.height) * sy)));
  return { x, y, width: right - x, height: bottom - y };
}

/** The reel rectangle of a screen recording in upright source pixels, or null for the whole frame. */
export async function detectReelCrop(
  path: string,
  planned: { readonly media: MediaContext; readonly plan: NormalisationPlan },
  signal: AbortSignal,
): AsyncResult<PixelBox | null> {
  const { media, plan } = planned;
  if (plan.kind !== 'video') return ok(null);
  let scan: CropScan | undefined;
  let misfits = 0;
  const sampled = await sampleFrames(path, plan, media, {
    fps: CROP_SCAN.fps,
    size: CROP_SCAN.longSide,
    format: 'gray8',
    signal,
    onFrame: (frame) => {
      scan ??= createCropScan(frame.width, frame.height);
      if (!scan.add(frame.data)) misfits += 1;
    },
  });
  if (!sampled.ok) return sampled;
  if (misfits > 0) {
    const detail = `crop scan: ${misfits} frame(s) were not ${sampled.value.width}x${sampled.value.height} gray`;
    return err(UnsupportedMedia(fileParams(path), { detail }));
  }
  const box = scan?.box() ?? null;
  if (!box) return ok(null);
  return ok(toSourceBox(box, sampled.value, { width: plan.facts.width, height: plan.facts.height }));
}
