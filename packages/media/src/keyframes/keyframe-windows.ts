// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Keyframe-only reads (IX2-T2): which keyframes a set of target times asks
 * for, and how many FFmpeg runs read them. A run seeks to its first target
 * and decodes only keyframes (`-skip_frame nokey`) up to a little past its
 * last one, so targets a short way apart share one run (one decoder session)
 * and far-apart targets (a long file) each get their own seek. A target takes
 * the first keyframe at or after it: never the file's first frame (a fade-in
 * from black starts most clips), and a keyframe that follows two targets is
 * read once.
 */

import { passedCount } from '../normalise/frame-select';

/**
 * Targets closer than this share one run. Measured on ix-v1 (IX2-T1, media SPEC): a VideoToolbox run costs
 * about 100 ms before its first frame, a 4K keyframe 3–16 ms, and phone footage has about one keyframe a
 * second, so reading 10 s of keyframes costs about what a second run does.
 */
export const KEYFRAME_WINDOW_GAP_SECONDS = 10;
/** How far past a window's last target a keyframe is looked for: longer than the GOPs of phone and camera footage. */
export const KEYFRAME_TAIL_SECONDS = 4;
/** A keyframe this close before a target counts as at it (container timestamps are rounded). */
const EPSILON_SECONDS = 0.001;

export interface KeyframeWindow {
  /** Where the run seeks: seconds from the start of the file. */
  readonly start: number;
  /** How much of the file the run reads from `start`, in seconds. */
  readonly span: number;
  /** Its targets, in seconds after `start`, ascending. */
  readonly targets: readonly number[];
}

export interface KeyframeWindowOptions {
  /** The video's duration in seconds: no window reads past it. */
  readonly duration: number;
  readonly gapSeconds?: number;
  readonly tailSeconds?: number;
}

/** Sorted, unique targets inside the file, grouped into runs. */
export function keyframeWindows(
  targets: readonly number[],
  options: KeyframeWindowOptions,
): KeyframeWindow[] {
  const gap = options.gapSeconds ?? KEYFRAME_WINDOW_GAP_SECONDS;
  const tail = options.tailSeconds ?? KEYFRAME_TAIL_SECONDS;
  const sorted = [
    ...new Set(targets.filter((t) => Number.isFinite(t) && t >= 0 && t < options.duration)),
  ].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const target of sorted) {
    const current = groups[groups.length - 1];
    const last = current?.[current.length - 1];
    if (current && last !== undefined && target - last <= gap) current.push(target);
    else groups.push([target]);
  }
  return groups.map((group) => {
    const first = group[0] as number;
    const start = Math.max(0, first - EPSILON_SECONDS);
    const end = Math.min(options.duration, (group[group.length - 1] as number) + tail);
    return { start, span: Math.max(end - start, EPSILON_SECONDS), targets: group.map((t) => t - start) };
  });
}

/** Six decimals: microseconds, finer than any frame. */
function seconds(value: number): string {
  return value.toFixed(6);
}

/**
 * `select` keeping the first frame at or after each target (seconds on the run's timeline): a frame is kept
 * when more targets lie at or before it than at or before the last kept frame (none, at first: comparisons
 * with `prev_selected_t`'s NaN are false). Commas are escaped for a filter graph. Past 32 targets each count
 * is a search FFmpeg can parse (normalise/frame-select.ts; a flat sum of 100 failed, EAR1-G3).
 */
export function firstAtOrAfter(targets: readonly number[]): string {
  const thresholds = (targets.length > 0 ? targets : [0]).map((t) => t - EPSILON_SECONDS);
  const passed = (at: string) => passedCount(at, thresholds, seconds);
  return `select='gt(${passed('t')}\\,${passed('prev_selected_t')})'`;
}
