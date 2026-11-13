// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * RationalTime: a whole number of units at an exact rate (OpenTimelineIO's
 * value + rate, with the rate kept as a rational). 24000 frames at 24000/1001
 * are exactly 1001 s, and adding one frame 10,000 times gives exactly 10,000
 * frames. Float seconds appear only at the edges (toSeconds, fromSeconds).
 *
 * Times are plain objects so they cross IPC and go into JSON unchanged.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { FrameRateValue, frameRateJsonSchema, frameRateSchema, type FrameRate } from './frame-rate-value';
import { assertSafeInteger, divide, roundFloat, toSafeNumber, type Rounding } from './rational';

export type { Rounding } from './rational';

export interface RationalTime {
  /** Whole units (frames, or samples for audio rates). May be negative for offsets. */
  readonly value: number;
  readonly rate: FrameRate;
}

function of(value: number, rate: FrameRate): RationalTime {
  assertSafeInteger(value, 'RationalTime value');
  return { value, rate };
}

function zero(rate: FrameRate): RationalTime {
  return { value: 0, rate };
}

/** Seconds to a time. Edges only (ffprobe floats, user input). Float noise never moves a frame. */
function fromSeconds(seconds: number, rate: FrameRate, rounding: Rounding = 'round'): RationalTime {
  return of(roundFloat((seconds * rate.num) / rate.den, rounding), rate);
}

/** Seconds as a float. Edges only (display, players); never store or add the result. */
function toSeconds(time: RationalTime): number {
  return (time.value * time.rate.den) / time.rate.num;
}

/** The same instant at another rate. Exact when the target rate is finer; rounded otherwise. */
function rescale(time: RationalTime, rate: FrameRate, rounding: Rounding = 'round'): RationalTime {
  if (FrameRateValue.equals(time.rate, rate)) return time;
  const numerator = BigInt(time.value) * BigInt(time.rate.den) * BigInt(rate.num);
  const denominator = BigInt(time.rate.num) * BigInt(rate.den);
  return of(toSafeNumber(divide(numerator, denominator, rounding), 'Rescaled time'), rate);
}

/** True when `time` lands exactly on a unit of `rate`, so rescale needs no rounding. */
function isExactIn(time: RationalTime, rate: FrameRate): boolean {
  const numerator = BigInt(time.value) * BigInt(time.rate.den) * BigInt(rate.num);
  return numerator % (BigInt(time.rate.num) * BigInt(rate.den)) === 0n;
}

/** Whole frames at `rate` (default: the time's own rate). */
function toFrames(time: RationalTime, rate: FrameRate = time.rate, rounding: Rounding = 'round'): number {
  return rescale(time, rate, rounding).value;
}

/** Both values on a common rate where each is a whole number: exact, no rounding. */
function align(a: RationalTime, b: RationalTime): [bigint, bigint, FrameRate] {
  if (FrameRateValue.equals(a.rate, b.rate)) return [BigInt(a.value), BigInt(b.value), a.rate];
  const rate = FrameRateValue.common(a.rate, b.rate);
  const scale = (t: RationalTime): bigint =>
    (BigInt(t.value) * BigInt(t.rate.den) * BigInt(rate.num)) / (BigInt(t.rate.num) * BigInt(rate.den));
  return [scale(a), scale(b), rate];
}

/** a + b. Same rate in, same rate out; mixed rates give the common rate (see FrameRate.common). */
function add(a: RationalTime, b: RationalTime): RationalTime {
  const [x, y, rate] = align(a, b);
  return of(toSafeNumber(x + y, 'Sum of times'), rate);
}

function subtract(a: RationalTime, b: RationalTime): RationalTime {
  const [x, y, rate] = align(a, b);
  return of(toSafeNumber(x - y, 'Difference of times'), rate);
}

/** -1, 0 or 1 by instant, across rates, with no rounding. */
function compare(a: RationalTime, b: RationalTime): -1 | 0 | 1 {
  const left = BigInt(a.value) * BigInt(a.rate.den) * BigInt(b.rate.num);
  const right = BigInt(b.value) * BigInt(b.rate.den) * BigInt(a.rate.num);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Same instant, whatever the rates (1 s at 25 equals 30 at 30). */
const equals = (a: RationalTime, b: RationalTime): boolean => compare(a, b) === 0;
const isBefore = (a: RationalTime, b: RationalTime): boolean => compare(a, b) < 0;
const isAfter = (a: RationalTime, b: RationalTime): boolean => compare(a, b) > 0;
const min = (a: RationalTime, b: RationalTime): RationalTime => (compare(b, a) < 0 ? b : a);
const max = (a: RationalTime, b: RationalTime): RationalTime => (compare(b, a) > 0 ? b : a);

/** n × time, e.g. the length of n beats. */
function multiply(time: RationalTime, factor: number): RationalTime {
  assertSafeInteger(factor, 'Factor');
  return of(toSafeNumber(BigInt(time.value) * BigInt(factor), 'Product of time'), time.rate);
}

export const RationalTime = {
  of,
  fromFrames: of,
  zero,
  fromSeconds,
  toSeconds,
  toFrames,
  rescale,
  isExactIn,
  add,
  subtract,
  multiply,
  compare,
  equals,
  isBefore,
  isAfter,
  min,
  max,
};

export const rationalTimeSchema = z.object({ value: z.int(), rate: frameRateSchema });

/**
 * A RationalTime as a model writes it, e.g. `{ value: 15, rate: { num: 30, den: 1 } }`: converts to JSON Schema
 * for tool and skill schemas. The bus validates the payload with rationalTimeSchema again on dispatch.
 */
export const rationalTimeJsonSchema = z.object({ value: z.int(), rate: frameRateJsonSchema });
