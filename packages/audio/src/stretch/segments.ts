// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Checks on a segment list both engines share: contiguous, inside the input, every ratio finite. */
import { err, ok, type Result } from '@taalcut/core';
import { StretchFailed } from './errors';
import type { StretchSegment } from './stretcher';

export function segmentRatio(segment: StretchSegment): number {
  const span = segment.sourceEnd - segment.sourceStart;
  return span > 0 ? segment.targetLength / span : Number.NaN;
}

export function checkSegments(segments: readonly StretchSegment[], inputFrames: number): Result<void> {
  if (segments.length === 0) return err(StretchFailed(undefined, { detail: 'no segments' }));
  let previousEnd: number | undefined;
  for (const [index, segment] of segments.entries()) {
    const ratio = segmentRatio(segment);
    const whole = [segment.sourceStart, segment.sourceEnd, segment.targetLength].every(Number.isInteger);
    if (!whole || !Number.isFinite(ratio) || ratio <= 0)
      return err(
        StretchFailed(undefined, { detail: `segment ${index} is not a positive whole-sample span` }),
      );
    if (segment.sourceStart < 0 || segment.sourceEnd > inputFrames)
      return err(StretchFailed(undefined, { detail: `segment ${index} lies outside the input` }));
    if (previousEnd !== undefined && segment.sourceStart !== previousEnd)
      return err(
        StretchFailed(undefined, { detail: `segment ${index} doesn't start where the last one ended` }),
      );
    previousEnd = segment.sourceEnd;
  }
  return ok(undefined);
}
