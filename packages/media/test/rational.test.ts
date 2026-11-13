// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { parseRational, rationalEquals, rationalToNumber, toSeconds } from '@taalcut/media';
import { decimalToRationalTime, isValidTime, ticksToRationalTime, toMicroseconds } from '../src/rational';

describe('rationals', () => {
  it('parses and reduces ratios exactly', () => {
    expect(parseRational('30000/1001')).toEqual({ num: 30000, den: 1001 });
    expect(parseRational('60/2')).toEqual({ num: 30, den: 1 });
    expect(parseRational('16:9')).toEqual({ num: 16, den: 9 });
    expect(parseRational('0/0')).toBeUndefined();
    expect(parseRational('25/0')).toBeUndefined();
    expect(parseRational('29.97')).toBeUndefined();
    expect(parseRational(undefined)).toBeUndefined();
  });

  it('compares without floating point', () => {
    expect(rationalEquals({ num: 30000, den: 1001 }, { num: 60000, den: 2002 })).toBe(true);
    expect(rationalEquals({ num: 30, den: 1 }, { num: 17985, den: 600 })).toBe(false);
    expect(rationalToNumber({ num: 1, den: 4 })).toBe(0.25);
  });

  it('turns ffprobe decimal seconds into exact microsecond times', () => {
    expect(decimalToRationalTime('2.002000')).toEqual({ value: 2002000, rate: 1000000 });
    expect(decimalToRationalTime('-0.021333')).toEqual({ value: -21333, rate: 1000000 });
    expect(decimalToRationalTime('3')).toEqual({ value: 3, rate: 1 });
    expect(decimalToRationalTime('N/A')).toBeUndefined();
    expect(decimalToRationalTime('99999999999999999999.5')).toBeUndefined();
  });

  it('turns ticks in a time base into RationalTime', () => {
    expect(ticksToRationalTime(60060, { num: 1, den: 30000 })).toEqual({ value: 60060, rate: 30000 });
    expect(ticksToRationalTime(3, { num: 1001, den: 30000 })).toEqual({ value: 3003, rate: 30000 });
  });

  it('converts to microseconds rounding down, and to seconds for display', () => {
    expect(toMicroseconds({ value: 1, rate: 30000 / 1001 })).toBe(33366);
    expect(toMicroseconds({ value: 1001, rate: 30000 })).toBe(33366);
    expect(toMicroseconds({ value: 30030, rate: 30000 })).toBe(1001000);
    expect(toMicroseconds({ value: -1, rate: 3 })).toBe(-333334);
    expect(toSeconds({ value: 60060, rate: 30000 })).toBeCloseTo(2.002, 9);
    expect(isValidTime({ value: 1, rate: 0 })).toBe(false);
    expect(isValidTime({ value: Number.NaN, rate: 1 })).toBe(false);
  });
});
