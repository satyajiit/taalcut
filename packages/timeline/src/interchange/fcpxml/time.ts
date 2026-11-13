// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FCPXML time: a rational number of seconds, `1001/30000s` or `5s`, computed exactly from RationalTime (BigInt,
 * never a float) so every value written from whole frames stays a multiple of its format's frameDuration.
 */
import type { FrameRate } from '@taalcut/core';
import { framesToSeconds, reduce, type Seconds } from '../seconds';

/** A float count of `rate` frames (a ramp's integral) to the nearest thousandth of a frame. */
export function approxFramesToSeconds(frames: number, rate: FrameRate): Seconds {
  return reduce(BigInt(Math.round(frames * 1000)) * BigInt(rate.den), 1000n * BigInt(rate.num));
}

/** As FCPXML writes it: `0s`, `5s`, `1001/30000s`. */
export function fcpTime(seconds: Seconds): string {
  const { num, den } = reduce(seconds.num, seconds.den);
  return den === 1n ? `${num}s` : `${num}/${den}s`;
}

/** One frame at `rate`: a format's frameDuration. */
export const frameDuration = (rate: FrameRate): string => fcpTime(framesToSeconds(1, rate));

/** `5s`, `1001/30000s` or `0s` back to seconds; null for anything else. */
export function parseFcpTime(text: string | null): Seconds | null {
  if (text === null) return null;
  const match = /^(-?\d+)(?:\/(\d+))?s$/.exec(text);
  if (!match) return null;
  const den = BigInt(match[2] ?? '1');
  return den === 0n ? null : reduce(BigInt(match[1] ?? '0'), den);
}
