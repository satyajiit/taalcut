// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the analysis pass already measured around a black run (IX3-D2), so shots can tell a fade through black from
 * a cut to black. No new decode: blackdetect's runs, scdet's every-frame scores and the 10-a-second statistics'
 * mean luma are all in the pass's document.
 *
 * - A run is blackdetect's, in seconds with its end on the first frame after it; on the grid it is the frames
 *   [from, to]. Runs a dim gap separates (no lit sample and no hard change between them: a frame or two of a fade's
 *   bottom over the threshold) are one stretch of black.
 * - Each side of a run is hard when scdet scores the edge frame (the first black frame, or the first frame after
 *   the black) at or above the cut score: the picture changed into or out of the black in one frame.
 * - Otherwise the side is a ramp: walking away from the run over the statistics samples, the picture keeps getting
 *   brighter (strictly, sample to sample) until it stops, or until a hard change between two samples (another
 *   cut). The ramp's far end is the brightest picture the fade left or reached, with its mean luma.
 */
import type { PassAnalysis } from '../analysis/frame-pass';

export interface FrameSpan {
  readonly from: number;
  readonly to: number;
}

export interface BlackSide {
  /** The picture changed into (out of) the black in one frame. */
  readonly hard: boolean;
  /** The ramp's far end: its brightest frame (the run's edge frame when hard or no sample lies on it). */
  readonly far: number;
  /** Mean luma there, 0–255, from the statistics sample; 0 when there is no ramp. */
  readonly luma: number;
}

export interface BlackRun {
  /** The black frames, first and last, on the grid. */
  readonly black: FrameSpan;
  readonly before: BlackSide;
  readonly after: BlackSide;
}

type Pass = Pick<PassAnalysis, 'fine' | 'samples'>;

/** blackdetect's run [start, end) in seconds as grid frames, first and last; undefined when it holds no frame. */
export function runFrames(run: { readonly startSec: number; readonly endSec: number }, fps: number) {
  const from = Math.round(run.startSec * fps);
  const to = Math.round(run.endSec * fps) - 1;
  return to >= from ? { from, to } : undefined;
}

/** Whether scdet scores any frame in (after, upTo] at or above `cutScore`: a sudden change in between. */
export function hardBetween(pass: Pass, after: number, upTo: number, cutScore: number): boolean {
  for (let frame = after + 1; frame <= upTo; frame++)
    if ((pass.fine[frame]?.[0] ?? 0) >= cutScore) return true;
  return false;
}

/** One side of the run: `edge` is the frame whose change scdet scored (the first black, or the first after). */
function side(pass: Pass, edge: number, direction: -1 | 1, cutScore: number): BlackSide {
  const hard = (pass.fine[edge]?.[0] ?? 0) >= cutScore;
  const start = direction < 0 ? edge : edge - 1;
  if (hard) return { hard, far: start, luma: 0 };
  const away =
    direction < 0
      ? pass.samples.filter((s) => s.index < edge).reverse()
      : pass.samples.filter((s) => s.index >= edge);
  let far = start;
  let luma = 0;
  let onRamp = false;
  for (const sample of away) {
    const [near, distant] = direction < 0 ? [sample.index, far] : [far, sample.index];
    if (hardBetween(pass, near, distant, cutScore)) break;
    if (onRamp && sample.mean <= luma) break;
    far = sample.index;
    luma = sample.mean;
    onRamp = true;
  }
  return { hard, far, luma };
}

/** The runs, in order, with those a dim gap separates joined: no sample under `litLuma` lit, no hard change. */
export function joinDimGaps(
  pass: Pass,
  runs: readonly FrameSpan[],
  rules: { readonly cutScore: number; readonly litLuma: number },
): FrameSpan[] {
  const out: FrameSpan[] = [];
  for (const run of [...runs].sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    const dim =
      last !== undefined &&
      !hardBetween(pass, last.to, run.from, rules.cutScore) &&
      pass.samples.every((s) => s.index <= last.to || s.index >= run.from || s.mean < rules.litLuma);
    if (last && dim) out[out.length - 1] = { from: last.from, to: Math.max(last.to, run.to) };
    else out.push(run);
  }
  return out;
}

/** The run and its two sides, from the pass's scores and samples. */
export function blackRun(pass: Pass, black: FrameSpan, cutScore: number): BlackRun {
  return {
    black,
    before: side(pass, black.from, -1, cutScore),
    after: side(pass, black.to + 1, 1, cutScore),
  };
}
