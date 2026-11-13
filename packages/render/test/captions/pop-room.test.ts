// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pop highlight's motion model (SPEC section 6, "Room for the pop"; captions/pop.ts): how far a popped word
 * grows, how far it pushes the other words of its line, how far a line reaches at its widest moment, how lines
 * stack, and the pop windows that keep one word of a cue popped at a time.
 */
import { describe, expect, it } from 'vitest';
import {
  lineReach,
  popLead,
  popWindows,
  POP_ORIGIN_Y,
  POP_PEAK_FRAMES,
  POP_SCALE,
  pushOf,
  roomHeight,
  sideGrowth,
  verticalGrowth,
} from '../../src/captions/pop';

/** A deterministic stream of numbers in [0, 1). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

interface Span {
  readonly left: number;
  readonly right: number;
}

/**
 * Each word's outline (its box widened by the stroke) at fraction `f` of word `popped`'s pop, as the compiler
 * draws a line set as plain text: one space between words, the popped word scaled about its centre, the words
 * before it moved left and those after it moved right by f × its push.
 */
function outlines(widths: readonly number[], popped: number, f: number, strokePx: number, spacePx: number) {
  const push = pushOf(widths[popped] ?? 0, { strokePx, spacePx });
  let x = 0;
  return widths.map((width, index): Span => {
    const left = x;
    x += width + spacePx;
    if (index === popped) {
      const half = (1 + f * (POP_SCALE - 1)) * (width / 2 + strokePx);
      return { left: left + width / 2 - half, right: left + width / 2 + half };
    }
    const by = widths.length > 1 ? (index < popped ? -1 : 1) * f * push : 0;
    return { left: left - strokePx + by, right: left + width + strokePx + by };
  });
}

describe('the pop motion model', () => {
  it('grows a word by (s − 1)(w/2 + stroke) a side, and its line box mostly upwards', () => {
    expect(POP_SCALE).toBe(1.18);
    expect(sideGrowth(200, 4)).toBeCloseTo(0.18 * 104, 9);
    expect(verticalGrowth(100)).toEqual({ rise: 10.8, drop: 7.2 });
    expect(POP_ORIGIN_Y).toBe(0.6);
  });

  it('pushes the other words of the line by the popped word’s growth', () => {
    expect(pushOf(200, { strokePx: 4, spacePx: 20 })).toBe(18.72);
    expect(pushOf(120, { strokePx: 0, spacePx: 20 })).toBe(10.8);
  });

  it('pushes further for a heavy stroke, to keep the outlines half a space apart', () => {
    // 2 × 16 px of stroke against a 12 px space: 26 px more than the growth.
    expect(pushOf(100, { strokePx: 16, spacePx: 12 })).toBe(37.88);
  });

  it('reaches past a line’s ends by its largest push, or a lone word’s growth', () => {
    expect(lineReach([], { strokePx: 4, spacePx: 20 })).toBe(0);
    expect(lineReach([120], { strokePx: 0, spacePx: 20 })).toBe(10.8);
    expect(lineReach([100, 200, 50], { strokePx: 4, spacePx: 20 })).toBe(18.72);
  });

  it('never lets a popped word come closer to a neighbour than half a space, or than plain text at rest', () => {
    const next = random(7);
    for (let trial = 0; trial < 500; trial++) {
      const widths = Array.from({ length: 1 + Math.floor(next() * 6) }, () => 20 + next() * 500);
      const strokePx = Math.floor(next() * 17);
      const spacePx = 8 + next() * 30;
      const reach = lineReach(widths, { strokePx, spacePx });
      const lineWidth = widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * spacePx;
      const least = Math.max(spacePx - 2 * strokePx, spacePx / 2);
      for (let popped = 0; popped < widths.length; popped++) {
        const peak = outlines(widths, popped, 1, strokePx, spacePx);
        const word = peak[popped];
        if (!word) throw new Error('no popped word');
        const before = peak[popped - 1];
        const after = peak[popped + 1];
        if (before) expect(word.left - before.right).toBeGreaterThanOrEqual(least - 1e-9);
        if (after) expect(after.left - word.right).toBeGreaterThanOrEqual(least - 1e-9);
        // Every moment of the pop, the line's outline stays within its reach past either end.
        for (const f of [0, 0.25, 0.5, 0.75, 1]) {
          const at = outlines(widths, popped, f, strokePx, spacePx);
          expect(Math.min(...at.map((span) => span.left))).toBeGreaterThanOrEqual(-strokePx - reach - 1e-9);
          expect(Math.max(...at.map((span) => span.right))).toBeLessThanOrEqual(
            lineWidth + strokePx + reach + 1e-9,
          );
        }
      }
    }
  });

  it('keeps the lead over every line and the drop under the last', () => {
    expect(popLead(100)).toBe(10.8);
    expect(roomHeight(0, 100)).toBe(0);
    expect(roomHeight(1, 100)).toBeCloseTo(18, 9);
    expect(roomHeight(3, 100)).toBeCloseTo(3 * 10.8 + 7.2, 9);
  });
});

describe('popWindows', () => {
  it('spans each word of a cue said one after another, peaking three frames in', () => {
    expect(
      popWindows([
        { start: 0, end: 6 },
        { start: 6, end: 8 },
        { start: 8, end: 9 },
      ]),
    ).toEqual([
      { start: 0, peak: POP_PEAK_FRAMES, end: 6 },
      { start: 6, peak: 7, end: 8 },
      { start: 8, peak: 8, end: 9 },
    ]);
  });

  it('ends a pop when the next word starts, so no two words are ever popped at once', () => {
    expect(
      popWindows([
        { start: 0, end: 10 },
        { start: 8, end: 20 },
      ]),
    ).toEqual([
      { start: 0, peak: 3, end: 8 },
      { start: 8, peak: 11, end: 20 },
    ]);
    // Out of order, and two starting together: the last of those pops.
    expect(
      popWindows([
        { start: 10, end: 20 },
        { start: 0, end: 12 },
        { start: 10, end: 14 },
        { start: 30, end: 30 },
      ]),
    ).toEqual([null, { start: 0, peak: 3, end: 10 }, { start: 10, peak: 13, end: 14 }, null]);
  });

  it('keeps every pair of windows apart, whatever the words', () => {
    const next = random(11);
    for (let trial = 0; trial < 300; trial++) {
      const spans = Array.from({ length: 2 + Math.floor(next() * 8) }, () => {
        const start = Math.floor(next() * 60);
        return { start, end: start + Math.floor(next() * 12) };
      });
      const windows = popWindows(spans).filter((window) => window !== null);
      for (const a of windows)
        for (const b of windows) if (a !== b) expect(a.end <= b.start || b.end <= a.start).toBe(true);
    }
  });
});
