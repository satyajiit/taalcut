// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Exact seconds for pro export (P3-V5): a reduced BigInt fraction, so times computed from whole frames at any
 * rate (24, 25, 30, 29.97, 59.94) add, compare and print without a float ever touching them.
 */
import type { FrameRate, RationalTime } from '@taalcut/core';

/** Exact seconds, reduced, `den > 0`. */
export interface Seconds {
  readonly num: bigint;
  readonly den: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
}

export function reduce(num: bigint, den: bigint): Seconds {
  const divisor = gcd(num, den) * (den < 0n ? -1n : 1n);
  return { num: num / divisor, den: den / divisor };
}

/** `frames` at `rate` as seconds. */
export function framesToSeconds(frames: number | bigint, rate: FrameRate): Seconds {
  return reduce(BigInt(frames) * BigInt(rate.den), BigInt(rate.num));
}

export const timeToSeconds = (time: RationalTime): Seconds => framesToSeconds(time.value, time.rate);

export const ZERO: Seconds = { num: 0n, den: 1n };

export const add = (a: Seconds, b: Seconds): Seconds => reduce(a.num * b.den + b.num * a.den, a.den * b.den);
export const subtract = (a: Seconds, b: Seconds): Seconds =>
  reduce(a.num * b.den - b.num * a.den, a.den * b.den);

/** Seconds as whole frames at `rate`; null when they don't land on a frame. */
export function secondsToFrames(seconds: Seconds, rate: FrameRate): number | null {
  const numerator = seconds.num * BigInt(rate.num);
  const denominator = seconds.den * BigInt(rate.den);
  return numerator % denominator === 0n ? Number(numerator / denominator) : null;
}

/** How a cut list spells seconds: 'n/d', reduced. */
export const secondsKey = (seconds: Seconds): string => {
  const { num, den } = reduce(seconds.num, seconds.den);
  return `${num}/${den}`;
};
