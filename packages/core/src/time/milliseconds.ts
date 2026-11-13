// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Milliseconds as media time. A whole number of milliseconds is exactly a RationalTime at 1000/1, so a provider's
 * millisecond length converts without rounding (then rescale it to the clip's rate once, naming the rounding), and
 * the few round P3-1 fields that stored milliseconds (a voice line's length, a motion graphic card's place, a
 * reference pointer's range, a graphics command's length) read back as RationalTime unchanged. Never store
 * milliseconds: SPEC section 3.
 */
import { z } from 'zod';
import { FrameRates } from './frame-rate-value';
import { RationalTime } from './rational-time';
import { TimeRange } from './time-range';

/** `ms` whole milliseconds, exactly. */
export function fromMilliseconds(ms: number): RationalTime {
  return RationalTime.of(ms, FrameRates.milliseconds);
}

/** Round P3-1's `{ startMs, endMs }`: the same span as a TimeRange at 1000/1. */
export const p31MillisecondRangeSchema = z
  .object({ startMs: z.int().nonnegative(), endMs: z.int().nonnegative() })
  .refine((range) => range.endMs >= range.startMs, { message: 'endMs is before startMs', path: ['endMs'] })
  .transform((range): TimeRange =>
    TimeRange.of(fromMilliseconds(range.startMs), fromMilliseconds(range.endMs - range.startMs)),
  );
