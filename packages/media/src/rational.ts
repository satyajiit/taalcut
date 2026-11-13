// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Exact rationals for frame rates and time bases, and the conversions from
 * ffprobe's text forms into RationalTime. Nothing here goes through a float
 * except toSeconds(), which exists for display and percentages only.
 */
import type { RationalTime } from './rational-time';

/** An exact ratio, e.g. a frame rate of 30000/1001 or a time base of 1/90000. Always reduced, den > 0. */
export interface Rational {
  readonly num: number;
  readonly den: number;
}

const RATIONAL = /^(-?\d+)[/:](\d+)$/;
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function safe(value: bigint): number | undefined {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Parses '30000/1001' (or '16:9'). Returns undefined for '0/0', a zero denominator or non-rational text. */
export function parseRational(text: string | undefined): Rational | undefined {
  const match = text ? RATIONAL.exec(text) : null;
  if (!match) return undefined;
  const num = BigInt(match[1] as string);
  const den = BigInt(match[2] as string);
  if (den === 0n) return undefined;
  const divisor = gcd(num, den) || 1n;
  const n = safe(num / divisor);
  const d = safe(den / divisor);
  return n === undefined || d === undefined ? undefined : { num: n, den: d };
}

export function rationalEquals(a: Rational, b: Rational): boolean {
  return BigInt(a.num) * BigInt(b.den) === BigInt(b.num) * BigInt(a.den);
}

export function rationalToNumber(r: Rational): number {
  return r.num / r.den;
}

/**
 * Parses ffprobe's decimal seconds ('2.002000', '-0.021333') exactly:
 * '2.002000' becomes { value: 2002000, rate: 1000000 }. ffprobe prints
 * AV_TIME_BASE (microsecond) values with six decimals, so this is lossless.
 */
export function decimalToRationalTime(text: string | undefined): RationalTime | undefined {
  const match = text ? DECIMAL.exec(text) : null;
  if (!match) return undefined;
  const [, sign, whole, fraction = ''] = match;
  const rate = 10n ** BigInt(fraction.length);
  const magnitude = BigInt(whole as string) * rate + BigInt(fraction || '0');
  const value = safe(sign === '-' ? -magnitude : magnitude);
  const r = safe(rate);
  return value === undefined || r === undefined ? undefined : { value, rate: r };
}

/** Ticks in a stream time base to RationalTime: 60060 ticks at 1/30000 is { value: 60060, rate: 30000 }. */
export function ticksToRationalTime(ticks: number, timeBase: Rational): RationalTime | undefined {
  const value = safe(BigInt(ticks) * BigInt(timeBase.num));
  return value === undefined ? undefined : { value, rate: timeBase.den };
}

export function isValidTime(t: RationalTime): boolean {
  return Number.isFinite(t.value) && Number.isFinite(t.rate) && t.rate > 0;
}

/** Whole microseconds, rounded down, which is FFmpeg's own time resolution (AV_TIME_BASE). */
export function toMicroseconds(t: RationalTime): number {
  if (Number.isSafeInteger(t.value) && Number.isSafeInteger(t.rate)) {
    const scaled = BigInt(t.value) * 1_000_000n;
    const rate = BigInt(t.rate);
    const quotient = scaled / rate;
    // BigInt division truncates toward zero; step down for negative non-exact results.
    return Number(scaled % rate !== 0n && scaled < 0n ? quotient - 1n : quotient);
  }
  return Math.floor((t.value * 1_000_000) / t.rate);
}

/** Float seconds, for display and percentages only. Never store the result as media time. */
export function toSeconds(t: RationalTime): number {
  return t.value / t.rate;
}
