// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shot-boundary scores (IX2-C1). Hard cuts first: a predicted boundary matches a labelled cut within
 * `tolerance` frames (one to one, `matchCuts`). Then dissolves: one of the boundaries left matches a dissolve
 * when its transition span (or its frame, when it has none) overlaps the dissolve's frames widened by the
 * tolerance; the one nearest the dissolve's middle is taken. Fades through black (IX3-D3) are matched the same
 * way from what the dissolves left: one boundary per fade, whatever kind the detector gave it, so a detector
 * that marks both ends of a fade has one false boundary. Whatever is left over is a false boundary, so it counts
 * against cut precision. Cut precision, recall and F1, dissolve and fade recall, and the same over every
 * boundary; totals are summed over clips before the ratios (micro averages).
 */
import { sumFields } from '@taalcut/core';
import { matchCuts } from '../match';
import type { PredictedBoundary } from './schema';
import type { ClipTruth, FrameSpan } from './truth';

export const SHOT_TOLERANCE_FRAMES = 1;

export interface BoundaryCounts {
  /** Labelled hard cuts, and those found. */
  readonly cuts: number;
  readonly cutsFound: number;
  /** Found at exactly the labelled frame. */
  readonly cutsExact: number;
  readonly dissolves: number;
  readonly dissolvesFound: number;
  readonly fades: number;
  readonly fadesFound: number;
  /** Predicted boundaries, and those that are neither a cut nor a dissolve nor a fade. */
  readonly predicted: number;
  readonly falseBoundaries: number;
}

export interface ClipScore extends BoundaryCounts {
  readonly file: string;
  readonly missedCuts: readonly number[];
  readonly missedDissolves: readonly FrameSpan[];
  readonly missedFades: readonly FrameSpan[];
  readonly extra: readonly number[];
}

export interface Ratios {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export interface ShotScores {
  readonly counts: BoundaryCounts;
  readonly cut: Ratios;
  readonly dissolveRecall: number;
  readonly fadeRecall: number;
  readonly all: Ratios;
}

const spanOf = (boundary: PredictedBoundary): FrameSpan =>
  boundary.span ?? { from: boundary.frame, to: boundary.frame };

const overlaps = (a: FrameSpan, b: FrameSpan) => a.from <= b.to && b.from <= a.to;

/**
 * Gradual transitions (dissolves, fades) matched to the boundaries left, those in `used` already taken: the
 * transitions missed (`used` gains the boundaries taken).
 */
function matchSpans(
  transitions: readonly FrameSpan[],
  left: readonly PredictedBoundary[],
  used: Set<number>,
  tolerance: number,
): FrameSpan[] {
  const missed: FrameSpan[] = [];
  for (const transition of transitions) {
    const widened = { from: transition.from - tolerance, to: transition.to + tolerance };
    const middle = (transition.from + transition.to) / 2;
    let best = -1;
    left.forEach((boundary, i) => {
      if (used.has(i) || !overlaps(spanOf(boundary), widened)) return;
      const nearer =
        best < 0 || Math.abs(boundary.frame - middle) < Math.abs((left[best]?.frame ?? 0) - middle);
      if (nearer) best = i;
    });
    if (best < 0) missed.push(transition);
    else used.add(best);
  }
  return missed;
}

export function scoreClip(
  truth: ClipTruth,
  predicted: readonly PredictedBoundary[],
  tolerance = SHOT_TOLERANCE_FRAMES,
): ClipScore {
  const boundaries = [...predicted].sort((a, b) => a.frame - b.frame);
  const cuts = matchCuts(
    truth.cuts,
    boundaries.map((b) => b.frame),
    tolerance,
  );
  // matchCuts reports frames; take the boundaries back by frame, one per unmatched frame.
  const remaining = [...cuts.unmatchedPredictions];
  const left = boundaries.filter((b) => {
    const at = remaining.indexOf(b.frame);
    if (at < 0) return false;
    remaining.splice(at, 1);
    return true;
  });
  const used = new Set<number>();
  const missedDissolves = matchSpans(truth.dissolves, left, used, tolerance);
  const missedFades = matchSpans(truth.fades, left, used, tolerance);
  const extra = left.filter((_, i) => !used.has(i)).map((b) => b.frame);
  return {
    file: truth.file,
    cuts: truth.cuts.length,
    cutsFound: cuts.matches.length,
    cutsExact: cuts.matches.filter((m) => m.distance === 0).length,
    dissolves: truth.dissolves.length,
    dissolvesFound: truth.dissolves.length - missedDissolves.length,
    fades: truth.fades.length,
    fadesFound: truth.fades.length - missedFades.length,
    predicted: boundaries.length,
    falseBoundaries: extra.length,
    missedCuts: cuts.missedTruths,
    missedDissolves,
    missedFades,
    extra,
  };
}

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : 1);

function ratios(found: number, labelled: number, falsePositives: number): Ratios {
  const precision = ratio(found, found + falsePositives);
  const recall = ratio(found, labelled);
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

/** Every count a clip's score adds up (sumFields' result must be a whole BoundaryCounts, so none is left out). */
const BOUNDARY_COUNT_KEYS = [
  'cuts',
  'cutsFound',
  'cutsExact',
  'dissolves',
  'dissolvesFound',
  'fades',
  'fadesFound',
  'predicted',
  'falseBoundaries',
] as const satisfies readonly (keyof BoundaryCounts)[];

export function sumCounts(clips: readonly BoundaryCounts[]): BoundaryCounts {
  return sumFields(clips, BOUNDARY_COUNT_KEYS);
}

export function shotScores(clips: readonly BoundaryCounts[]): ShotScores {
  const counts = sumCounts(clips);
  return {
    counts,
    cut: ratios(counts.cutsFound, counts.cuts, counts.falseBoundaries),
    dissolveRecall: ratio(counts.dissolvesFound, counts.dissolves),
    fadeRecall: ratio(counts.fadesFound, counts.fades),
    all: ratios(
      counts.cutsFound + counts.dissolvesFound + counts.fadesFound,
      counts.cuts + counts.dissolves + counts.fades,
      counts.falseBoundaries,
    ),
  };
}
