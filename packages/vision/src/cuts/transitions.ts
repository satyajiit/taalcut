// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shot boundaries from TransNetV2's per-frame predictions (IX2-C4), as upstream's `predictions_to_scenes`
 * reads them: a transition is a run of stream frames whose single-frame probability is over the threshold
 * (0.5 upstream); the shot before ends on the run's first frame and the next starts after its last. Around
 * each run the many-hot head marks the transition's frames.
 *
 * Shots tile the asset (core's shot contract), so each transition is one boundary on the grid:
 * - where the pass's full-grid scene score (scdet) shows a sharp change inside the transition's frames, a hard
 *   cut on that frame. The many-hot head runs wide around some hard cuts in moving footage, and the
 *   single-frame head can peak a frame off the change, while scdet's score is high only on a sudden change: at
 *   most 2.5 inside every ix-v1 dissolve (the pass's own scores, vision SPEC);
 * - otherwise, a many-hot span of at least `gradualFrames` stream frames is gradual (a dissolve or a fade),
 *   placed at its middle as the breakdown places a soft cut, its span kept;
 * - otherwise a hard cut after the run: on the next stream frame, or where the stream skips grid frames (60 fps
 *   read at 30), on the grid frame between the two where scdet sees the most change.
 */
import type { BoundaryPredictions } from './stream-predictor';

export interface Transition {
  /** First grid frame of the new shot. */
  readonly frame: number;
  readonly kind: 'cut' | 'dissolve';
  /** The transition's grid frames, first and last. */
  readonly span: { readonly from: number; readonly to: number };
  /** The run's highest single-frame probability. */
  readonly probability: number;
}

/** The grid frame where the picture changes most, and scdet's score there. */
export interface SharpestChange {
  readonly frame: number;
  readonly score: number;
}

export interface TransitionOptions {
  readonly threshold: number;
  /** Many-hot spans this many stream frames long or longer are gradual, unless a hard cut is inside. */
  readonly gradualFrames: number;
  /** scdet's score at or above which a change is a hard cut. */
  readonly cutScore: number;
  /** The sharpest change in grid frames (after, upTo]; absent (no scores): the model's frames decide. */
  readonly locate?: (after: number, upTo: number) => SharpestChange | undefined;
}

/** Runs of indexes whose value is over `threshold`, as [first, last]. */
function runsOver(values: Float32Array, threshold: number): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let k = 0; k <= values.length; k++) {
    const over = k < values.length && (values[k] ?? 0) > threshold;
    if (over && start < 0) start = k;
    if (!over && start >= 0) {
      runs.push([start, k - 1]);
      start = -1;
    }
  }
  return runs;
}

/** The many-hot span around a run: the run, widened while the frames next to it are inside a transition. */
function spanAround(manyHot: Float32Array, run: [number, number], threshold: number): [number, number] {
  let [from, to] = run;
  while (from > 0 && (manyHot[from - 1] ?? 0) > threshold) from -= 1;
  while (to + 1 < manyHot.length && (manyHot[to + 1] ?? 0) > threshold) to += 1;
  return [from, to];
}

/** The transition over stream frames [from, to] around a run [first, last], as one boundary on the grid. */
function boundary(
  predictions: BoundaryPredictions,
  options: TransitionOptions,
  run: readonly [number, number],
  [from, to]: readonly [number, number],
): Transition {
  const { single, every } = predictions;
  let probability = 0;
  for (let k = run[0]; k <= run[1]; k++) probability = Math.max(probability, single[k] ?? 0);
  const span = { from: from * every, to: (to + 1) * every - 1 };
  // The new shot's first frame is in the span or just after it.
  const sharp = options.locate?.(Math.max(0, span.from - 1), span.to + 1);
  if (sharp && sharp.score >= options.cutScore) return { frame: sharp.frame, kind: 'cut', span, probability };
  if (to - from + 1 >= options.gradualFrames) {
    return { frame: Math.round(((from + to + 1) / 2) * every), kind: 'dissolve', span, probability };
  }
  const between = every > 1 ? options.locate?.(run[1] * every, (run[1] + 1) * every) : undefined;
  return { frame: between?.frame ?? (run[1] + 1) * every, kind: 'cut', span, probability };
}

export function transitionsFrom(predictions: BoundaryPredictions, options: TransitionOptions): Transition[] {
  const { single, manyHot, every } = predictions;
  const out: Transition[] = [];
  for (const run of runsOver(single, options.threshold)) {
    // Upstream never starts a scene with a transition at frame 0: the first run there is the video's own start.
    if (run[0] === 0) continue;
    out.push(boundary(predictions, options, run, spanAround(manyHot, run, options.threshold)));
  }
  // Two runs inside one transition can find the same sharp change: one boundary.
  return out
    .filter((t) => t.frame > 0 && t.frame < single.length * every)
    .sort((a, b) => a.frame - b.frame)
    .filter((t, i, all) => i === 0 || t.frame !== all[i - 1]?.frame);
}
