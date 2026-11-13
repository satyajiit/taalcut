// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import {
  FrameRate,
  FrameRates,
  frameRateSchema,
  RationalTime,
  rationalTimeSchema,
  unwrap,
  type FrameRate as Rate,
} from '@taalcut/core';

const { fps23_976, fps24, fps25, fps29_97, fps30, fps59_94, fps60, hz48000 } = FrameRates;
const VIDEO_RATES: [string, Rate][] = [
  ['23.976', fps23_976],
  ['25', fps25],
  ['29.97', fps29_97],
  ['30', fps30],
  ['60', fps60],
];

describe('FrameRate', () => {
  it('keeps rates exact and reduced', () => {
    expect(fps29_97).toEqual({ num: 30000, den: 1001 });
    expect(FrameRate.of(48000, 2)).toEqual({ num: 24000, den: 1 });
    expect(FrameRate.toNumber(fps23_976)).toBeCloseTo(23.976, 3);
    expect(FrameRate.isNtsc(fps59_94)).toBe(true);
    expect(FrameRate.isNtsc(fps25)).toBe(false);
    expect(FrameRate.nominal(fps23_976)).toBe(24);
    expect(FrameRate.equals(FrameRate.of(60, 2), fps30)).toBe(true);
    expect(() => FrameRate.of(0)).toThrow(RangeError);
    expect(() => FrameRate.of(24.5)).toThrow(RangeError);
  });

  it('turns the decimals people write into exact rates', () => {
    expect(unwrap(FrameRate.fromFps(23.976))).toEqual(fps23_976);
    expect(unwrap(FrameRate.fromFps(23.98))).toEqual(fps23_976);
    expect(unwrap(FrameRate.fromFps(29.97))).toEqual(fps29_97);
    expect(unwrap(FrameRate.fromFps(59.94))).toEqual(fps59_94);
    expect(unwrap(FrameRate.fromFps(25))).toEqual(fps25);
    expect(unwrap(FrameRate.fromFps(12.5))).toEqual({ num: 25, den: 2 });
    expect(FrameRate.fromFps(0).ok).toBe(false);
    expect(FrameRate.fromFps(Number.NaN).ok).toBe(false);
    expect(FrameRate.fromFps(Math.SQRT2).ok).toBe(false);
  });

  it('parses ffprobe ratios and decimals', () => {
    expect(unwrap(FrameRate.parse('30000/1001'))).toEqual(fps29_97);
    expect(unwrap(FrameRate.parse(' 24000:1001 '))).toEqual(fps23_976);
    expect(unwrap(FrameRate.parse('59.94'))).toEqual(fps59_94);
    expect(unwrap(FrameRate.parse('25'))).toEqual(fps25);
    for (const bad of ['0/0', '', 'abc', '25fps', '1e3', '-25']) {
      const result = FrameRate.parse(bad);
      expect(!result.ok && result.error.code).toBe('core.validation');
    }
  });

  it('finds the common rate on which both rates are whole', () => {
    expect(FrameRate.common(fps23_976, fps25)).toEqual({ num: 24000, den: 1 });
    expect(FrameRate.common(fps29_97, fps23_976)).toEqual({ num: 120000, den: 1001 });
    expect(FrameRate.common(fps30, fps30)).toBe(fps30);
  });

  it('validates rates from IPC', () => {
    expect(frameRateSchema.parse({ num: 48000, den: 2 })).toEqual({ num: 24000, den: 1 });
    expect(frameRateSchema.safeParse({ num: 0, den: 1 }).success).toBe(false);
    expect(frameRateSchema.safeParse({ num: 29.97, den: 1 }).success).toBe(false);
  });
});

describe('RationalTime: no drift', () => {
  it.each(VIDEO_RATES)('adds one frame 10,000 times at %s fps and gets exactly 10,000 frames', (_, rate) => {
    const oneFrame = RationalTime.fromFrames(1, rate);
    let time = RationalTime.zero(rate);
    for (let i = 0; i < 10_000; i++) time = RationalTime.add(time, oneFrame);
    expect(time).toEqual(RationalTime.fromFrames(10_000, rate));
    expect(RationalTime.toSeconds(time)).toBeCloseTo((10_000 * rate.den) / rate.num, 9);
  });

  it.each(VIDEO_RATES)('subtracts back to zero at %s fps', (_, rate) => {
    let time = RationalTime.fromFrames(10_000, rate);
    for (let i = 0; i < 10_000; i++) time = RationalTime.subtract(time, RationalTime.fromFrames(1, rate));
    expect(time).toEqual(RationalTime.zero(rate));
  });

  it('round-trips through a finer rate, exactly or with rounding', () => {
    const pairs: [Rate, Rate][] = [
      [fps23_976, fps29_97],
      [fps25, fps60],
      [fps29_97, fps59_94],
      [fps23_976, fps25],
      [fps30, hz48000],
      [fps24, fps23_976],
    ];
    for (const [coarse, fine] of pairs) {
      const common = FrameRate.common(coarse, fine);
      for (let n = -50; n <= 2000; n++) {
        const time = RationalTime.fromFrames(n, coarse);
        const viaCommon = RationalTime.rescale(RationalTime.rescale(time, common), coarse);
        expect(viaCommon).toEqual(time);
        expect(RationalTime.isExactIn(time, common)).toBe(true);
        if (FrameRate.toNumber(fine) > FrameRate.toNumber(coarse)) {
          const viaFine = RationalTime.rescale(RationalTime.rescale(time, fine), coarse);
          expect(viaFine.value).toBe(n);
        }
      }
    }
  });

  it('adds and compares across rates without rounding', () => {
    const sum = RationalTime.add(RationalTime.fromFrames(1, fps23_976), RationalTime.fromFrames(1, fps25));
    expect(sum).toEqual({ value: 1001 + 960, rate: { num: 24000, den: 1 } });
    expect(RationalTime.equals(RationalTime.fromFrames(25, fps25), RationalTime.fromFrames(30, fps30))).toBe(
      true,
    );
    expect(
      RationalTime.equals(RationalTime.fromFrames(24_000, fps23_976), RationalTime.fromFrames(24_024, fps24)),
    ).toBe(true);
    const ntscSecond = RationalTime.fromFrames(30, fps29_97);
    const second = RationalTime.fromFrames(30, fps30);
    expect(RationalTime.compare(ntscSecond, second)).toBe(1);
    expect(RationalTime.isAfter(ntscSecond, second)).toBe(true);
    expect(RationalTime.isBefore(second, ntscSecond)).toBe(true);
    expect(RationalTime.max(second, ntscSecond)).toBe(ntscSecond);
    expect(RationalTime.min(second, ntscSecond)).toBe(second);
    expect(RationalTime.subtract(ntscSecond, second)).toEqual({ value: 30, rate: { num: 30000, den: 1 } });
  });

  it('rescales with explicit rounding', () => {
    const minusOne = RationalTime.fromFrames(-1, fps24);
    expect(RationalTime.rescale(minusOne, fps30, 'floor').value).toBe(-2);
    expect(RationalTime.rescale(minusOne, fps30, 'ceil').value).toBe(-1);
    expect(RationalTime.rescale(minusOne, fps30).value).toBe(-1);
    expect(RationalTime.toFrames(RationalTime.fromFrames(3, fps24), fps30, 'floor')).toBe(3);
    expect(RationalTime.toFrames(RationalTime.fromFrames(3, fps24), fps30, 'ceil')).toBe(4);
    expect(RationalTime.toFrames(RationalTime.fromFrames(7, fps24))).toBe(7);
    expect(RationalTime.isExactIn(RationalTime.fromFrames(1, fps24), fps30)).toBe(false);
  });

  it('converts seconds only at the edges, ignoring float noise', () => {
    expect(RationalTime.fromSeconds(10.01, fps23_976, 'floor').value).toBe(240);
    expect(RationalTime.fromSeconds(0.5, fps25, 'floor').value).toBe(12);
    expect(RationalTime.fromSeconds(0.5, fps25, 'ceil').value).toBe(13);
    expect(RationalTime.fromSeconds(0.5, fps25).value).toBe(13);
    expect(RationalTime.toSeconds(RationalTime.fromFrames(24_000, fps23_976))).toBe(1001);
    expect(() => RationalTime.fromSeconds(Number.POSITIVE_INFINITY, fps25)).toThrow(RangeError);
  });

  it('multiplies, and refuses fractional or overflowing values', () => {
    expect(RationalTime.multiply(RationalTime.fromFrames(12, fps24), 4)).toEqual(
      RationalTime.fromFrames(48, fps24),
    );
    expect(() => RationalTime.of(1.5, fps24)).toThrow(RangeError);
    expect(() => RationalTime.multiply(RationalTime.fromFrames(1, fps24), 0.5)).toThrow(RangeError);
    const huge = RationalTime.of(Number.MAX_SAFE_INTEGER, fps24);
    expect(() => RationalTime.add(huge, huge)).toThrow(/out of range/);
  });

  it('validates times from IPC', () => {
    expect(rationalTimeSchema.parse({ value: 5, rate: { num: 60, den: 2 } })).toEqual(
      RationalTime.of(5, fps30),
    );
    expect(rationalTimeSchema.safeParse({ value: 0.5, rate: fps30 }).success).toBe(false);
  });
});
