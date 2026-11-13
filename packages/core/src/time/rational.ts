// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Exact integer helpers for media time. Products like value × den × num can pass
 * 2^53 for long audio at NTSC rates, so the maths runs in BigInt and only the
 * result comes back as a Number, checked to be a safe integer.
 */

/**
 * How to turn an exact fraction into a whole number of frames.
 * 'round' is nearest, with ties going up (towards +Infinity), like Math.round.
 */
export type Rounding = 'floor' | 'ceil' | 'round';

export const ROUNDINGS: readonly Rounding[] = ['floor', 'ceil', 'round'];

export function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

export function lcm(a: bigint, b: bigint): bigint {
  return (a / gcd(a, b)) * b;
}

/** numerator / denominator as a whole number, rounded as asked. The denominator must be positive. */
export function divide(numerator: bigint, denominator: bigint, rounding: Rounding): bigint {
  let quotient = numerator / denominator;
  let remainder = numerator % denominator;
  // BigInt division truncates towards zero; make it floor division.
  if (remainder < 0n) {
    quotient -= 1n;
    remainder += denominator;
  }
  if (remainder === 0n) return quotient;
  if (rounding === 'floor') return quotient;
  if (rounding === 'ceil') return quotient + 1n;
  return 2n * remainder >= denominator ? quotient + 1n : quotient;
}

/** Converts back to a Number, or throws: a time this large is a bug, not an outcome. */
export function toSafeNumber(value: bigint, what: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} is out of range: ${value}`);
  return n;
}

export function assertSafeInteger(value: number, what: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${what} must be a safe integer, got ${value}`);
}

/** Rounds a float that should be whole, snapping float noise (1/1001 sums) to the nearest integer first. */
export function roundFloat(x: number, rounding: Rounding): number {
  if (!Number.isFinite(x)) throw new RangeError(`Expected a finite number, got ${x}`);
  const nearest = Math.round(x);
  if (Math.abs(x - nearest) <= 1e-6 + Math.abs(x) * 1e-12) return nearest;
  if (rounding === 'floor') return Math.floor(x);
  if (rounding === 'ceil') return Math.ceil(x);
  return nearest;
}
