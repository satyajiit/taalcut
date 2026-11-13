// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Round P3-3: half-open frame spans in one place (the timeline's cleanup planner and time map, render's QA
 * plan), with the timeline's interval rules: touching spans join, empty ones go, holes cut exactly.
 */
import { describe, expect, it } from 'vitest';
import { coveredFrames, mergeSpans, spanFrames, subtractSpans, type FrameSpan } from '@taalcut/core';

const s = (start: number, end: number): FrameSpan => ({ start, end });

describe('frame spans', () => {
  it('merge sorted, joining overlapping and touching spans and dropping empty ones', () => {
    expect(mergeSpans([])).toEqual([]);
    expect(mergeSpans([s(10, 20), s(0, 5), s(5, 8), s(15, 30), s(40, 40), s(50, 45)])).toEqual([
      s(0, 8),
      s(10, 30),
    ]);
    expect(mergeSpans([s(0, 10), s(2, 3)])).toEqual([s(0, 10)]);
    // Fractions while planning.
    expect(mergeSpans([s(0.5, 1.25), s(1.25, 2)])).toEqual([s(0.5, 2)]);
  });

  it('do not change what they were given', () => {
    const given = [s(10, 20), s(0, 12)];
    const copy = given.map((span) => ({ ...span }));
    const merged = mergeSpans(given);
    expect(given).toEqual(copy);
    expect(merged[0]).not.toBe(given[1]);
  });

  it('subtract every hole, merged, from merged spans', () => {
    expect(subtractSpans([s(0, 100)], [s(10, 20), s(15, 30), s(90, 120)])).toEqual([s(0, 10), s(30, 90)]);
    expect(subtractSpans([s(0, 10), s(5, 20)], [])).toEqual([s(0, 20)]);
    expect(subtractSpans([s(0, 10)], [s(0, 10)])).toEqual([]);
    expect(subtractSpans([s(0, 10), s(20, 30)], [s(5, 25)])).toEqual([s(0, 5), s(25, 30)]);
    // A hole that only touches cuts nothing.
    expect(subtractSpans([s(10, 20)], [s(0, 10), s(20, 30)])).toEqual([s(10, 20)]);
  });

  it('measure how much of a span a cover covers, counting overlaps once', () => {
    expect(coveredFrames(s(0, 100), [s(10, 20), s(50, 150)])).toBe(60);
    expect(coveredFrames(s(0, 100), [s(10, 30), s(20, 40)])).toBe(30);
    expect(coveredFrames(s(0, 10), [s(10, 20)])).toBe(0);
    expect(spanFrames(s(3, 7))).toBe(4);
    expect(spanFrames(s(7, 3))).toBe(0);
  });

  it('agree, frame by frame, with a brute-force count', () => {
    let seed = 7;
    const next = () => (seed = (seed * 48271) % 2147483647) % 60;
    const spansOf = (count: number, divisor: number) =>
      Array.from({ length: count }, () => {
        const start = next();
        return s(start, start + next() / divisor);
      });
    const inAny = (list: readonly FrameSpan[], frame: number) =>
      list.some((span) => span.start <= frame && frame < span.end);
    for (let round = 0; round < 200; round++) {
      const spans = spansOf(5, 4);
      const holes = spansOf(3, 3);
      const kept = subtractSpans(spans, holes);
      const merged = mergeSpans(spans);
      for (let frame = 0; frame < 80; frame++) {
        expect(inAny(kept, frame)).toBe(inAny(spans, frame) && !inAny(holes, frame));
        expect(inAny(merged, frame)).toBe(inAny(spans, frame));
      }
      const whole = spansOf(6, 1);
      const window = s(10, 50);
      let frames = 0;
      for (let frame = window.start; frame < window.end; frame++) if (inAny(whole, frame)) frames++;
      expect(coveredFrames(window, whole)).toBe(frames);
    }
  });
});
