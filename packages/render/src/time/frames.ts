// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frame arithmetic for compositions (SPEC section 3, "Timing"). Every value
 * is computed from integers with BigInt; seconds appear only as the decimal
 * strings HyperFrames reads, rounded by the SPEC's rules:
 *
 * - a boundary at frame k is ⌊k·den·10⁹ / num⌋ / 10⁹ s, so frame k (sampled at
 *   k/fps) falls inside the half-open window that starts at k, never the one
 *   that ends there;
 * - a duration of N frames is N·den/num rounded to 9 decimals, which the
 *   producer's frame count rounds back to exactly N;
 * - a media start is the in-point plus half a frame, so the extracted source
 *   frame is the centre of the intended one.
 */
import { FrameRate, RationalTime } from '@taalcut/core';

const NANO = 1_000_000_000n;

/** The rates Phase 2 renders (HyperFrames' Fps is rational). 25 and 50 are refused at preflight. */
export const SUPPORTED_RATES: readonly FrameRate[] = [
  FrameRate.of(24),
  FrameRate.of(30),
  FrameRate.of(60),
  FrameRate.of(30000, 1001),
  FrameRate.of(60000, 1001),
];

export function isSupportedRate(rate: FrameRate): boolean {
  return SUPPORTED_RATES.some((supported) => FrameRate.equals(supported, rate));
}

export function rateLabel(rate: FrameRate): string {
  return rate.den === 1 ? String(rate.num) : `${rate.num}/${rate.den}`;
}

/** Nanoseconds as a decimal string with up to 9 decimals and no trailing zeros ("1.033333333", "2"). */
function nanosToDecimal(nanos: bigint): string {
  const negative = nanos < 0n;
  const abs = negative ? -nanos : nanos;
  const whole = abs / NANO;
  const fraction = (abs % NANO).toString().padStart(9, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Floor division that rounds toward minus infinity. */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return (a % b !== 0n && a < 0n !== b < 0n) ? q - 1n : q;
}

/** The nanosecond instant of frame k at `rate`, floored: ⌊k·den·10⁹ / num⌋. */
export function frameNanos(frame: number, rate: FrameRate): bigint {
  return floorDiv(BigInt(frame) * BigInt(rate.den) * NANO, BigInt(rate.num));
}

/** A clip boundary at frame k, as HyperFrames reads it (`data-start`). */
export function boundarySeconds(frame: number, rate: FrameRate): string {
  return nanosToDecimal(frameNanos(frame, rate));
}

/** N frames as seconds rounded to 9 decimals (`data-duration` of the root). */
export function durationSeconds(frames: number, rate: FrameRate): string {
  const num = BigInt(frames) * BigInt(rate.den) * NANO;
  const den = BigInt(rate.num);
  const rounded = (num * 2n + den) / (den * 2n);
  return nanosToDecimal(rounded);
}

/** A window [start, end) in frames as (data-start, data-duration) strings: end − start computed on nanos. */
export function windowSeconds(start: number, end: number, rate: FrameRate): { start: string; duration: string } {
  const a = frameNanos(start, rate);
  const b = frameNanos(end, rate);
  return { start: nanosToDecimal(a), duration: nanosToDecimal(b - a) };
}

/** A source in-point plus half a frame of the output rate (`data-media-start`). */
export function mediaStartSeconds(inPoint: RationalTime, outputRate: FrameRate): string {
  // inPoint seconds = value·den/num; half a frame = den_o / (2·num_o). Sum in nanos, floored.
  const a = BigInt(inPoint.value) * BigInt(inPoint.rate.den) * NANO * 2n * BigInt(outputRate.num);
  const b = BigInt(outputRate.den) * NANO * BigInt(inPoint.rate.num);
  const den = BigInt(inPoint.rate.num) * 2n * BigInt(outputRate.num);
  return nanosToDecimal(floorDiv(a + b, den));
}

/** Milliseconds of frame k as a float (WAAPI delays and durations take doubles). */
export function frameMs(frame: number, rate: FrameRate): number {
  return (frame * rate.den * 1000) / rate.num;
}

/** A time at the canvas rate as a whole frame. Throws when the time isn't on a frame (a bug upstream). */
export function toFrame(time: RationalTime, rate: FrameRate): number {
  if (!RationalTime.isExactIn(time, rate)) {
    throw new RangeError(`Time ${time.value}@${time.rate.num}/${time.rate.den} is not on a frame at ${rateLabel(rate)}`);
  }
  return RationalTime.toFrames(time, rate);
}

/** Frame k of `rate` at the media's own rate, rounded down (the source frame showing at that instant). */
export function framesAt(time: RationalTime, rate: FrameRate, rounding: 'floor' | 'round' = 'floor'): number {
  return RationalTime.toFrames(time, rate, rounding);
}

/** Samples at `sampleRate` in N frames of `rate`, rounded: round(N · sampleRate · den / num). */
export function samplesForFrames(frames: number, rate: FrameRate, sampleRate: number): number {
  const num = BigInt(frames) * BigInt(sampleRate) * BigInt(rate.den);
  const den = BigInt(rate.num);
  return Number((num * 2n + den) / (den * 2n));
}

/** The first sample of frame k, rounded the same way, so adjacent spans tile exactly. */
export const sampleOfFrame = samplesForFrames;
