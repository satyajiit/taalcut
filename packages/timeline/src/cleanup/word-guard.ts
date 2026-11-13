// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * No clipped words, by construction (P3-V9, talking-head research §5): every kept word is widened by the pad on
 * both sides and taken out of every removal, then each removal is rounded inward to whole canvas frames and one
 * under the minimum goes. A kept piece left too short to hold a word goes too. So no kept word loses a frame,
 * whatever the analysis said; render's short crossfade on each join covers a bad zero crossing.
 */
import { complement, covered, merge, subtract, type Interval } from '../model/intervals';

export interface GuardOptions {
  /** Kept around every word, in clip frames. */
  readonly padFrames: number;
  /** The shortest removal (and the shortest wordless piece kept between two removals). */
  readonly minFrames: number;
}

/** Floating error in a frame position never moves a cut a whole frame. */
const EPSILON = 1e-6;

export function guardRemovals(
  candidates: readonly Interval[],
  keptWords: readonly Interval[],
  total: number,
  options: GuardOptions,
): Interval[] {
  const padded = keptWords.map((word) => ({ start: word.start - options.padFrames, end: word.end + options.padFrames }));
  const clear = subtract(candidates, padded);
  const whole = clear
    .map((span) => ({ start: Math.max(0, Math.ceil(span.start - EPSILON)), end: Math.min(total, Math.floor(span.end + EPSILON)) }))
    .filter((span) => span.end - span.start >= options.minFrames);
  const removals = merge(whole);
  // A sliver kept between two removals with no word in it goes with them.
  const pieces = complement(removals, total).filter(
    (piece) => piece.end - piece.start >= options.minFrames || covered(piece, padded) > 0,
  );
  return complement(pieces, total);
}

/** True when no kept word overlaps a removal: the property the tests check on every fixture. */
export function wordsKept(removals: readonly Interval[], keptWords: readonly Interval[]): boolean {
  return keptWords.every((word) => covered(word, removals) === 0);
}
