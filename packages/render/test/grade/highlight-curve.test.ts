// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { NEUTRAL_GRADE } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { highlightChannel, highlightTable } from '../../src/grade/highlight-curve';

describe('highlight and white shoulders', () => {
  it('leaves an old or explicitly neutral grade untouched', () => {
    expect(highlightTable(NEUTRAL_GRADE)).toBeNull();
    expect(highlightTable({ ...NEUTRAL_GRADE, highlights: 0, whites: 0 })).toBeNull();
  });

  it('softens bright lights without darkening black or mid grey', () => {
    const grade = { highlights: -1, whites: -1 };
    for (const value of [0, 0.1, 0.25, 0.5]) expect(highlightChannel(value, grade)).toBe(value);
    expect(highlightChannel(0.75, grade)).toBe(0.625);
    expect(highlightChannel(1, grade)).toBe(0.75);
    expect(highlightChannel(1, { whites: -1 })).toBe(0.875);
    expect(highlightChannel(0.75, { whites: -1 })).toBe(0.75);
    expect(highlightChannel(0.75, { highlights: 0.5 })).toBeGreaterThan(0.75);
  });

  it('never reverses tones or exceeds the display range, including opposing controls', () => {
    for (const highlights of [-1, -0.5, 0, 0.5, 1]) {
      for (const whites of [-1, -0.5, 0, 0.5, 1]) {
        let previous = 0;
        for (let index = 0; index <= 1000; index++) {
          const value = highlightChannel(index / 1000, { highlights, whites });
          expect(value).toBeGreaterThanOrEqual(previous);
          expect(value).toBeLessThanOrEqual(1);
          previous = value;
        }
      }
    }
  });

  it('uses a bounded table whose sampled midpoint stays exact', () => {
    const table = highlightTable({ ...NEUTRAL_GRADE, highlights: -0.6, whites: -0.4 })!
      .split(' ')
      .map(Number);
    expect(table).toHaveLength(65);
    expect(table[0]).toBe(0);
    expect(table[32]).toBe(0.5);
    expect(table[64]).toBeLessThan(0.85);
  });
});
