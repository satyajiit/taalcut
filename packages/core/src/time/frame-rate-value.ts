// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The FrameRate value: an exact rational, always stored reduced (48000/2 becomes 24000/1), so two equal rates
 * have equal fields; its arithmetic and its schemas. No error model: reading a rate from text or fps returns a
 * Result and lives in frame-rate.ts, so this module (and @taalcut/core/hub, which reaches it) has no side effect.
 * See packages/core/SPEC.md, "Media time".
 */
import { z } from 'zod';
import { assertSafeInteger, gcd, lcm, toSafeNumber } from './rational';

export interface FrameRate {
  /** Units per `den` seconds, e.g. 30000 for 29.97 fps. */
  readonly num: number;
  /** 1 for whole rates, 1001 for NTSC rates. */
  readonly den: number;
}

function of(num: number, den = 1): FrameRate {
  assertSafeInteger(num, 'Frame rate numerator');
  assertSafeInteger(den, 'Frame rate denominator');
  if (num <= 0 || den <= 0) throw new RangeError(`Frame rate must be positive, got ${num}/${den}`);
  const divisor = gcd(BigInt(num), BigInt(den));
  return { num: num / Number(divisor), den: den / Number(divisor) };
}

/**
 * The coarsest rate on which both rates' units land on whole numbers:
 * lcm(numerators) / gcd(denominators). Adding times at 24000/1001 and 25 happens
 * at 24000/1, where one 23.976 frame is 1001 units and one 25 fps frame is 960.
 */
function common(a: FrameRate, b: FrameRate): FrameRate {
  if (equals(a, b)) return a;
  const num = lcm(BigInt(a.num), BigInt(b.num));
  const den = gcd(BigInt(a.den), BigInt(b.den));
  return of(toSafeNumber(num, 'Common frame rate'), toSafeNumber(den, 'Common frame rate'));
}

function equals(a: FrameRate, b: FrameRate): boolean {
  return a.num === b.num && a.den === b.den;
}

/** True when the rate is written in lowest terms (30/1, not 60/2). */
function isReduced(rate: FrameRate): boolean {
  return gcd(BigInt(rate.num), BigInt(rate.den)) === 1n;
}

/** For display and float maths at the edges only. */
function toNumber(rate: FrameRate): number {
  return rate.num / rate.den;
}

function isNtsc(rate: FrameRate): boolean {
  return rate.den === 1001 && rate.num % 1000 === 0;
}

/** The whole-number rate timecode counts in: 24 for 23.976, 30 for 29.97. */
function nominal(rate: FrameRate): number {
  return Math.round(rate.num / rate.den);
}

/** FrameRate without parsing (frame-rate.ts adds fromFps and parse). */
export const FrameRateValue = { of, common, equals, isReduced, toNumber, isNtsc, nominal };

/** The rates Taalcut meets most. Use these instead of writing rationals by hand. */
export const FrameRates = {
  fps23_976: of(24000, 1001),
  fps24: of(24),
  fps25: of(25),
  fps29_97: of(30000, 1001),
  fps30: of(30),
  fps50: of(50),
  fps59_94: of(60000, 1001),
  fps60: of(60),
  /** Audio sample rates. */
  hz44100: of(44100),
  hz48000: of(48000),
  /** One unit a millisecond: how round P3-1's millisecond fields read as RationalTime (exactly). */
  milliseconds: of(1000),
} as const;

/**
 * A rate as written, `{ num, den }`, whole and positive, not yet reduced: converts to JSON Schema, so
 * model-facing schemas use it (frameRateSchema's transform can't convert).
 */
export const frameRateJsonSchema = z.object({ num: z.int().positive(), den: z.int().positive() });

/** Validates and reduces a rate from IPC or storage. */
export const frameRateSchema = frameRateJsonSchema.transform((rate): FrameRate => of(rate.num, rate.den));
