// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import {
  formatTimecode,
  FrameRate,
  FrameRates,
  parseTimecode,
  RationalTime,
  TimeRange,
  timeRangeSchema,
  unwrap,
} from '@taalcut/core';

const { fps23_976, fps25, fps29_97, fps30, fps59_94, fps24 } = FrameRates;
const at = RationalTime.fromFrames;

describe('TimeRange', () => {
  const r = (start: number, duration: number, rate = fps25) =>
    TimeRange.of(at(start, rate), at(duration, rate));

  it('has an exclusive end and contains its start but not its end', () => {
    const range = r(10, 5);
    expect(TimeRange.end(range)).toEqual(at(15, fps25));
    expect(TimeRange.contains(range, at(10, fps25))).toBe(true);
    expect(TimeRange.contains(range, at(14, fps25))).toBe(true);
    expect(TimeRange.contains(range, at(15, fps25))).toBe(false);
    expect(TimeRange.contains(r(10, 0), at(10, fps25))).toBe(false);
    expect(TimeRange.isEmpty(r(10, 0))).toBe(true);
  });

  it('overlaps, touches, intersects and spans', () => {
    expect(TimeRange.overlaps(r(0, 10), r(5, 10))).toBe(true);
    expect(TimeRange.overlaps(r(0, 10), r(10, 10))).toBe(false);
    expect(TimeRange.overlaps(r(0, 10), r(5, 0))).toBe(false);
    expect(TimeRange.intersection(r(0, 10), r(5, 10))).toEqual(r(5, 5));
    expect(TimeRange.intersection(r(0, 10), r(10, 10))).toBeUndefined();
    expect(TimeRange.span(r(0, 2), r(8, 2))).toEqual(r(0, 10));
    expect(TimeRange.containsRange(r(0, 10), r(2, 8))).toBe(true);
    expect(TimeRange.containsRange(r(0, 10), r(2, 9))).toBe(false);
    expect(TimeRange.shift(r(0, 10), at(3, fps25))).toEqual(r(3, 10));
    expect(TimeRange.equals(r(0, 25), r(0, 30, fps30))).toBe(true);
  });

  it('puts mixed rates on one exact rate', () => {
    const mixed = TimeRange.of(at(1, fps23_976), at(1, fps25));
    expect(mixed.start.rate).toEqual(mixed.duration.rate);
    expect(RationalTime.equals(TimeRange.end(mixed), RationalTime.add(at(1, fps23_976), at(1, fps25)))).toBe(
      true,
    );
    const fromEnds = TimeRange.fromStartEnd(at(0, fps24), at(30, fps30));
    expect(RationalTime.equals(fromEnds.duration, at(24, fps24))).toBe(true);
  });

  it('rescales start and end separately so touching ranges keep touching', () => {
    const a = r(0, 7, fps24);
    const b = r(7, 5, fps24);
    const a30 = TimeRange.rescale(a, fps30);
    const b30 = TimeRange.rescale(b, fps30);
    expect(TimeRange.end(a30)).toEqual(b30.start);
    expect(TimeRange.rescale(a, fps24)).toEqual(a);
  });

  it('rejects negative durations and validates ranges from IPC', () => {
    expect(() => r(0, -1)).toThrow(RangeError);
    expect(() => TimeRange.fromStartEnd(at(5, fps25), at(4, fps25))).toThrow(RangeError);
    expect(timeRangeSchema.parse({ start: at(1, fps25), duration: at(2, fps25) })).toEqual(r(1, 2));
    expect(timeRangeSchema.safeParse({ start: at(1, fps25), duration: at(-2, fps25) }).success).toBe(false);
  });
});

describe('timecode', () => {
  it('formats whole and NTSC non-drop rates by their nominal rate', () => {
    expect(formatTimecode(at(90_000, fps25))).toBe('01:00:00:00');
    expect(formatTimecode(at(86_400, fps23_976))).toBe('01:00:00:00');
    expect(formatTimecode(at(1_799, fps30))).toBe('00:00:59:29');
    expect(formatTimecode(at(1_800, fps29_97), { dropFrame: false })).toBe('00:01:00:00');
    expect(formatTimecode(at(-26, fps25))).toBe('-00:00:01:01');
  });

  it('formats drop-frame at 29.97 and 59.94', () => {
    expect(formatTimecode(at(1_799, fps29_97))).toBe('00:00:59;29');
    expect(formatTimecode(at(1_800, fps29_97))).toBe('00:01:00;02');
    expect(formatTimecode(at(17_982, fps29_97))).toBe('00:10:00;00');
    expect(formatTimecode(at(107_892, fps29_97))).toBe('01:00:00;00');
    expect(formatTimecode(at(3_600, fps59_94))).toBe('00:01:00;04');
  });

  it('round-trips every frame through format and parse', () => {
    for (const rate of [fps23_976, fps25, fps29_97, fps59_94]) {
      for (let frame = 0; frame < 40_000; frame += 7) {
        const time = at(frame, rate);
        expect(unwrap(parseTimecode(formatTimecode(time), rate))).toEqual(time);
      }
    }
    expect(unwrap(parseTimecode('-00:00:01:01', fps25))).toEqual(at(-26, fps25));
    expect(unwrap(parseTimecode('00:01:00:00', fps29_97))).toEqual(at(1_800, fps29_97));
    expect(unwrap(parseTimecode('00:01:00,02', fps29_97))).toEqual(at(1_800, fps29_97));
  });

  it('rejects labels that do not exist', () => {
    for (const [text, rate] of [
      ['00:01:00;00', fps29_97],
      ['00:01:00;03', fps59_94],
      ['00:00:00:25', fps25],
      ['00:60:00:00', fps25],
      ['00:00:00;00', fps25],
      ['1:00:00:00', fps25],
      ['nonsense', fps25],
    ] as const) {
      const result = parseTimecode(text, rate);
      expect(!result.ok && result.error.code, text).toBe('core.validation');
    }
    expect(unwrap(parseTimecode('00:10:00;00', fps29_97))).toEqual(at(17_982, fps29_97));
  });

  it('writes 119.88 fps (120000/1001) as non-drop with ":" (review 2)', () => {
    const fps119_88 = unwrap(FrameRate.fromFps(119.88));
    expect(fps119_88).toEqual({ num: 120000, den: 1001 });
    expect(formatTimecode(at(7_200, fps119_88))).toBe('00:01:00:00');
    expect(formatTimecode(at(0, fps119_88))).toBe('00:00:00:00');
    for (let frame = 0; frame < 200_000; frame += 997) {
      const time = at(frame, fps119_88);
      const label = formatTimecode(time);
      expect(label).not.toContain(';');
      expect(unwrap(parseTimecode(label, fps119_88))).toEqual(time);
    }
    expect(() => formatTimecode(at(1, fps119_88), { dropFrame: true })).toThrow(/Drop-frame/);
    expect(parseTimecode('00:01:00;08', fps119_88).ok).toBe(false);
  });

  it('never echoes the input in an error detail (review 2)', () => {
    const secret = `sk-live-${'SECRETTOKEN'.repeat(2)}`;
    for (const result of [parseTimecode(secret, fps25), FrameRate.parse(secret)]) {
      expect(!result.ok && result.error.code).toBe('core.validation');
      expect(JSON.stringify(result)).not.toContain('SECRETTOKEN');
    }
  });

  it('refuses rates timecode cannot express', () => {
    expect(() => formatTimecode(at(1, { num: 25, den: 2 }))).toThrow(RangeError);
    expect(() => formatTimecode(at(1, fps25), { dropFrame: true })).toThrow(/Drop-frame/);
  });
});
