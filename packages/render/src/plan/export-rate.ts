// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, FrameRate, ok, type Result, type Timeline } from '@taalcut/core';
import { UnsupportedFrameRate } from '../errors';
import { isSupportedRate, rateLabel } from '../time/frames';

/**
 * An export-only sampling grid. Keep every RationalTime and source in-point unchanged: a 30 fps cut's
 * captions, motion and sound last the same time at 60 fps. Whole multiples preserve every possible edit
 * boundary exactly; other conversions need a rounding policy and are refused before planning.
 */
export function timelineAtExportRate(timeline: Timeline, rate: FrameRate): Result<Timeline> {
  const source = timeline.canvas.rate;
  const numerator = BigInt(rate.num) * BigInt(source.den);
  const denominator = BigInt(rate.den) * BigInt(source.num);
  if (!isSupportedRate(rate) || numerator % denominator !== 0n)
    return err(
      UnsupportedFrameRate(
        { rate: rateLabel(rate) },
        { detail: `Export rate must preserve the ${rateLabel(source)} fps timeline frame grid exactly` },
      ),
    );
  return ok(
    FrameRate.equals(rate, source) ? timeline : { ...timeline, canvas: { ...timeline.canvas, rate } },
  );
}
