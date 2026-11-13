// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `select` expressions over many frames or times that FFmpeg can parse at any count (EAR1-G3), commas escaped
 * for a filter graph.
 *
 * FFmpeg's expression parser refuses a tree deeper than 100 levels (`MAX_DEPTH` in libavutil/eval.c, FFmpeg
 * 9.0.2): the graph won't open and FFmpeg reports "Cannot allocate memory". A sum `eq(n,a)+eq(n,b)+…` parses
 * left-deep, one level a term, so it holds at most 100 frames; a breakdown asks for three a shot and failed from
 * about 34 shots. Small sets keep that sum, the expression every earlier release built. Larger ones merge runs
 * of consecutive frames into `between(n,a,b)`, sum a few runs in each leaf, and find the leaf by a balanced
 * binary search on `n` (`if(lt(n,pivot),below,above)`). `if` evaluates only the branch it takes, so the depth
 * and the work for each decoded frame grow with the log of the runs, however sparse they are across a long file.
 * The text stays about 15 characters a frame. `rangesExpression` builds the same search from ranges, and
 * `passedCount` counts the thresholds a time has reached by a search of its own (keyframe reads' `firstAtOrAfter`
 * compared two flat sums of `gte`, and failed past 99 targets).
 */

/** Up to this many frames (or thresholds), the plain sum. */
export const FLAT_FRAMES = 32;
/** Runs (or thresholds) summed in one leaf of a search. */
const LEAF_TERMS = 8;

/** Grid frames `first` to `last`, both kept. */
export interface FrameRun {
  readonly first: number;
  readonly last: number;
}

/**
 * The frames as the expression reads them: whole, not negative, each once. As the plain sum read them: NaN and
 * +Infinity name no frame (`eq(n,nan)` never holds), and -Infinity is frame 0, like any negative.
 */
export function selectedFrames(indexes: readonly number[]): number[] {
  const named = indexes.filter((index) => !Number.isNaN(index) && index !== Number.POSITIVE_INFINITY);
  return [...new Set(named.map((index) => Math.max(0, Math.floor(index))))];
}

/**
 * Keeps exactly `selectedFrames(indexes)` on `n`: nothing (`0`) when none of those asked names a frame, and frame 0
 * when none is asked at all, as every release has.
 */
export function framesExpression(indexes: readonly number[]): string {
  if (indexes.length === 0) return term(0, 0);
  const frames = selectedFrames(indexes);
  if (frames.length === 0) return '0';
  if (frames.length <= FLAT_FRAMES) return frames.map((frame) => term(frame, frame)).join('+');
  return runsExpression(frames.sort((a, b) => a - b).map((frame) => ({ first: frame, last: frame })));
}

/**
 * Keeps every frame of the runs on `n`, overlapping or not, in any order; none keeps nothing (`0`). An infinite
 * end is clamped as the plain `between` read it: -Infinity first is frame 0, +Infinity last runs to the end of the
 * file; a NaN end, a +Infinity first or a -Infinity last keeps nothing.
 */
export function rangesExpression(runs: readonly FrameRun[]): string {
  const sorted = runs
    .filter((run) => !Number.isNaN(run.first) && !Number.isNaN(run.last))
    .map((run) => ({ first: Math.max(0, Math.ceil(run.first)), last: Math.floor(run.last) }))
    .filter((run) => Number.isFinite(run.first) && run.last >= run.first)
    .sort((a, b) => a.first - b.first);
  return sorted.length > 0 ? runsExpression(sorted) : '0';
}

/**
 * How many of `thresholds` `at` has reached: `gte(at,threshold)` summed (none for NaN, as `gte` gives), each
 * threshold written by `format`. Up to 32 thresholds, that sum in the order given; more, a binary search on the
 * sorted thresholds that carries the count of those it has passed.
 */
export function passedCount(
  at: string,
  thresholds: readonly number[],
  format: (value: number) => string = String,
): string {
  const reached = (value: number) => `gte(${at}\\,${format(value)})`;
  if (thresholds.length <= FLAT_FRAMES) return thresholds.map(reached).join('+') || '0';
  const sorted = [...thresholds].sort((a, b) => a - b);
  const count = (from: number, to: number, passed: number): string => {
    if (to - from <= LEAF_TERMS) {
      const terms = sorted.slice(from, to).map(reached);
      return (passed > 0 ? [String(passed), ...terms] : terms).join('+');
    }
    const middle = (from + to) >> 1;
    const above = count(middle, to, passed + middle - from);
    return `if(${reached(sorted[middle] ?? 0)}\\,${above}\\,${count(from, middle, passed)})`;
  };
  return count(0, sorted.length, 0);
}

/** Sorted runs, merged where they touch or overlap, summed a few to a leaf and found by a search on `n`. */
function runsExpression(sorted: readonly FrameRun[]): string {
  const merged: { first: number; last: number }[] = [];
  for (const run of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && run.first <= previous.last + 1) previous.last = Math.max(previous.last, run.last);
    else merged.push({ ...run });
  }
  const leaves: FrameRun[][] = [];
  for (const run of merged) {
    const leaf = leaves[leaves.length - 1];
    if (leaf && leaf.length < LEAF_TERMS) leaf.push(run);
    else leaves.push([run]);
  }
  return search(leaves, 0, leaves.length);
}

function term(first: number, last: number): string {
  if (last === Number.POSITIVE_INFINITY) return `gte(n\\,${first})`;
  return first === last ? `eq(n\\,${first})` : `between(n\\,${first}\\,${last})`;
}

/** Leaves `from`…`to - 1`: frames before the middle leaf's first frame go left. */
function search(leaves: readonly (readonly FrameRun[])[], from: number, to: number): string {
  if (to - from === 1) return (leaves[from] ?? []).map((run) => term(run.first, run.last)).join('+');
  const middle = (from + to) >> 1;
  const pivot = leaves[middle]?.[0]?.first ?? 0;
  return `if(lt(n\\,${pivot})\\,${search(leaves, from, middle)}\\,${search(leaves, middle, to)})`;
}
