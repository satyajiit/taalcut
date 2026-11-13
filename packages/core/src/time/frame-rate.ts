// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frame rates as exact rationals: 29.97 fps is 30000/1001, never 29.97. The value, its arithmetic and its
 * schemas are frame-rate-value.ts; this module adds reading a rate from text or fps, as a Result. See
 * packages/core/SPEC.md, "Media time".
 */
import { ValidationError } from '../basics/errors';
import { err, ok, type Result } from '../basics/result';
import { FrameRateValue, type FrameRate as FrameRateShape } from './frame-rate-value';

export { FrameRates, frameRateJsonSchema, frameRateSchema } from './frame-rate-value';
export type FrameRate = FrameRateShape;

const { of } = FrameRateValue;

/** A fixed message: the input is never echoed into `detail`. */
const invalidRate = (): Result<FrameRate> =>
  err(ValidationError({ field: 'rate' }, { detail: 'Not a usable frame rate' }));

/** NTSC rates are n × 1000/1001; people write them as 23.976, 23.98, 29.97, 59.94. */
const NTSC_TOLERANCE = 0.005;
const MAX_DECIMAL_DENOMINATOR = 1000;

function fromFps(fps: number): Result<FrameRate> {
  if (!Number.isFinite(fps) || fps <= 0) return invalidRate();
  if (Number.isSafeInteger(fps)) return ok(of(fps));
  const whole = Math.round(fps * 1.001);
  if (whole > 0 && Math.abs(fps - (whole * 1000) / 1001) < NTSC_TOLERANCE) return ok(of(whole * 1000, 1001));
  // Decimal rates such as 12.5 or 14.99. The tight tolerance rejects floats that
  // only approximate a fraction (any real is within 5e-7 of some n/1000).
  for (let den = 2; den <= MAX_DECIMAL_DENOMINATOR; den++) {
    const num = fps * den;
    if (Math.abs(num - Math.round(num)) < 1e-9) return ok(of(Math.round(num), den));
  }
  return invalidRate();
}

const RATIO = /^(\d+)\s*[/:]\s*(\d+)$/;

/** Parses '30000/1001' (ffprobe's r_frame_rate), '30000:1001', '29.97' or '25'. */
function parse(text: string): Result<FrameRate> {
  const trimmed = text.trim();
  const match = RATIO.exec(trimmed);
  if (match) {
    const num = Number(match[1]);
    const den = Number(match[2]);
    // ffprobe reports '0/0' when it doesn't know the rate.
    if (num <= 0 || den <= 0 || !Number.isSafeInteger(num) || !Number.isSafeInteger(den))
      return invalidRate();
    return ok(of(num, den));
  }
  if (trimmed === '' || !/^\d*\.?\d+$/.test(trimmed)) return invalidRate();
  return fromFps(Number(trimmed));
}

export const FrameRate = { ...FrameRateValue, fromFps, parse };
