// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Frame maths for compositions: SPEC section 3's rounding rules at every supported rate. */
import { describe, expect, it } from 'vitest';
import { FrameRate, RationalTime } from '@taalcut/core';
import {
  boundarySeconds,
  durationSeconds,
  frameNanos,
  isSupportedRate,
  mediaStartSeconds,
  samplesForFrames,
  toFrame,
  windowSeconds,
} from '../../src/time/frames';

const ntsc = FrameRate.of(30000, 1001);

describe('frame boundaries', () => {
  it('writes whole-rate boundaries exactly', () => {
    expect(boundarySeconds(0, FrameRate.of(30))).toBe('0');
    expect(boundarySeconds(30, FrameRate.of(30))).toBe('1');
    expect(boundarySeconds(31, FrameRate.of(30))).toBe('1.033333333');
    expect(boundarySeconds(1, FrameRate.of(24))).toBe('0.041666666');
  });

  it('floors NTSC boundaries to the nanosecond, so frame k samples inside the next window', () => {
    // 1 frame at 29.97 = 1001/30000 s = 0.0333666… s.
    expect(boundarySeconds(1, ntsc)).toBe('0.033366666');
    for (const k of [1, 7, 299, 1799, 3599]) {
      const sample = (k * ntsc.den) / ntsc.num;
      const boundary = Number(boundarySeconds(k, ntsc));
      expect(boundary).toBeLessThanOrEqual(sample);
      expect(sample - boundary).toBeLessThan(1e-9);
    }
  });

  it('rounds durations to 9 decimals so N frames come back as exactly N', () => {
    for (const rate of [
      FrameRate.of(24),
      FrameRate.of(30),
      FrameRate.of(60),
      ntsc,
      FrameRate.of(60000, 1001),
    ]) {
      for (const n of [1, 2, 29, 30, 31, 299, 1798, 1800, 3600]) {
        const seconds = Number(durationSeconds(n, rate));
        expect(Math.round((seconds * rate.num) / rate.den)).toBe(n);
        expect(Math.abs((seconds * rate.num) / rate.den - n)).toBeLessThan(1e-6);
      }
    }
  });

  it('builds windows from the same floored instants, so adjacent windows tile', () => {
    const a = windowSeconds(0, 37, ntsc);
    const b = windowSeconds(37, 90, ntsc);
    expect(BigInt(Math.round(Number(a.start) * 1e9)) + BigInt(Math.round(Number(a.duration) * 1e9))).toBe(
      frameNanos(37, ntsc),
    );
    expect(b.start).toBe(boundarySeconds(37, ntsc));
  });

  it('puts a media start half a frame after the in-point', () => {
    expect(mediaStartSeconds(RationalTime.of(30, FrameRate.of(30)), FrameRate.of(30))).toBe('1.016666666');
    expect(mediaStartSeconds(RationalTime.of(0, FrameRate.of(25)), FrameRate.of(30))).toBe('0.016666666');
  });

  it('knows the supported rates and refuses 25 and 50', () => {
    expect(isSupportedRate(ntsc)).toBe(true);
    expect(isSupportedRate(FrameRate.of(25))).toBe(false);
    expect(isSupportedRate(FrameRate.of(50))).toBe(false);
  });

  it('counts samples per frame span exactly', () => {
    expect(samplesForFrames(1800, FrameRate.of(30), 48000)).toBe(2_880_000);
    expect(samplesForFrames(1798, ntsc, 48000)).toBe(Math.round((1798 * 48000 * 1001) / 30000));
  });

  it('refuses a time that is not on a frame', () => {
    expect(toFrame(RationalTime.of(2002, FrameRate.of(60000)), ntsc)).toBe(1);
    expect(() => toFrame(RationalTime.of(1, FrameRate.of(60000)), ntsc)).toThrow(RangeError);
  });
});
