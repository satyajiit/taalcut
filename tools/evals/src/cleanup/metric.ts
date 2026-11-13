// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CleanupLabel, CleanupPrediction, FrameRange } from './schema';

export const CLEANUP_BARS = { removedShare: 0.9, clippedWords: 0 } as const;

export interface CleanupCaseScore {
  readonly caseId: string;
  readonly labelled: number;
  readonly removed: number;
  readonly removedShare: number;
  readonly clippedWords: number;
  readonly falseRemovals: number;
}

function overlap(left: FrameRange, right: FrameRange): number {
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
}

function covered(range: FrameRange, covers: readonly FrameRange[]): number {
  return covers.reduce((sum, cover) => sum + overlap(range, cover), 0);
}

/** At least half the labelled span is inside a removal. */
export function spanRemoved(range: FrameRange, removals: readonly FrameRange[]): boolean {
  const length = range.end - range.start;
  if (length <= 0) return false;
  return covered(range, removals) * 2 >= length;
}

export function scoreCleanupCase(label: CleanupLabel, prediction: CleanupPrediction): CleanupCaseScore {
  const targets = [...label.fillers, ...label.pauses];
  const removed = targets.filter((range) => spanRemoved(range, prediction.removals)).length;
  const clippedWords = label.words.filter((word) => covered(word, prediction.removals) > 0).length;
  const falseRemovals = prediction.removals.filter((range) => covered(range, targets) === 0).length;
  return {
    caseId: label.caseId,
    labelled: targets.length,
    removed,
    removedShare: targets.length === 0 ? 0 : removed / targets.length,
    clippedWords,
    falseRemovals,
  };
}

export function cleanupGatePasses(row: CleanupCaseScore): boolean {
  return row.removedShare >= CLEANUP_BARS.removedShare && row.clippedWords <= CLEANUP_BARS.clippedWords;
}
