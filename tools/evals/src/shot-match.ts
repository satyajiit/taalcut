// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type EvalShot, type FrameRange } from './adapters/types';

/**
 * A predicted shot matches a labelled one when it is the same asset and the
 * two half-open frame ranges overlap by at least half of the shorter one.
 * A label with no range matches any shot of that asset.
 */
export function shotsMatch(label: EvalShot, predicted: EvalShot): boolean {
  if (label.asset !== predicted.asset) return false;
  if (label.range === undefined) return true;
  if (predicted.range === undefined) return false;
  return overlapShare(label.range, predicted.range) >= 0.5;
}

/** Overlap length divided by the shorter range. Empty ranges share nothing. */
export function overlapShare(a: FrameRange, b: FrameRange): number {
  const overlap = Math.min(a.endFrame, b.endFrame) - Math.max(a.startFrame, b.startFrame);
  const shorter = Math.min(a.endFrame - a.startFrame, b.endFrame - b.startFrame);
  if (overlap <= 0 || shorter <= 0) return 0;
  return overlap / shorter;
}

/** The first predicted shot that matches, or -1. Rank is 0-based. */
export function firstMatchIndex(relevant: readonly EvalShot[], predicted: readonly EvalShot[]): number {
  return predicted.findIndex((shot) => relevant.some((label) => shotsMatch(label, shot)));
}
