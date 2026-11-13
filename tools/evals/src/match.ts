// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A predicted cut matches a true cut when it lands within this many frames. */
export const CUT_TOLERANCE_FRAMES = 2;

export interface CutMatch {
  truth: number;
  predicted: number;
  distance: number;
}

export interface MatchResult {
  matches: CutMatch[];
  missedTruths: number[];
  unmatchedPredictions: number[];
}

interface Candidate {
  truthIndex: number;
  predictedIndex: number;
  truth: number;
  predicted: number;
  distance: number;
}

/**
 * One-to-one greedy matching. Cut lists are short, so Hungarian adds nothing.
 * Ties break by distance, then the true frame, then the predicted frame.
 */
export function matchCuts(
  truth: readonly number[],
  predicted: readonly number[],
  tolerance = CUT_TOLERANCE_FRAMES,
): MatchResult {
  const candidates: Candidate[] = [];
  truth.forEach((truthFrame, truthIndex) => {
    predicted.forEach((predictedFrame, predictedIndex) => {
      const distance = Math.abs(truthFrame - predictedFrame);
      if (distance <= tolerance) {
        candidates.push({
          truthIndex,
          predictedIndex,
          truth: truthFrame,
          predicted: predictedFrame,
          distance,
        });
      }
    });
  });
  candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
      a.truth - b.truth ||
      a.predicted - b.predicted ||
      a.truthIndex - b.truthIndex,
  );

  const usedTruth = new Set<number>();
  const usedPredicted = new Set<number>();
  const matches: CutMatch[] = [];
  for (const candidate of candidates) {
    if (usedTruth.has(candidate.truthIndex) || usedPredicted.has(candidate.predictedIndex)) continue;
    usedTruth.add(candidate.truthIndex);
    usedPredicted.add(candidate.predictedIndex);
    matches.push({
      truth: candidate.truth,
      predicted: candidate.predicted,
      distance: candidate.distance,
    });
  }
  matches.sort((a, b) => a.truth - b.truth || a.predicted - b.predicted);

  return {
    matches,
    missedTruths: truth.filter((_, index) => !usedTruth.has(index)),
    unmatchedPredictions: predicted.filter((_, index) => !usedPredicted.has(index)),
  };
}
