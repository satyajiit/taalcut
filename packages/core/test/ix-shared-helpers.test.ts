// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Round IX review-fix pass (IX-F4, IX-F5): small helpers several packages kept their own copies of. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jsonFromText, overlapArea, parseJsonWith } from '../src/index';

describe('jsonFromText and parseJsonWith (core-requests-audio #1)', () => {
  it('parses JSON text', () => {
    expect(jsonFromText('{"a":1}')).toEqual({ a: 1 });
    expect(jsonFromText('[1,"two",null]')).toEqual([1, 'two', null]);
  });

  it('reads text that is not JSON as undefined, never throwing', () => {
    expect(jsonFromText('<html>')).toBeUndefined();
    expect(jsonFromText('')).toBeUndefined();
    expect(jsonFromText('{"a":')).toBeUndefined();
  });

  it('gives the schema-checked value, or null when the text or its shape is wrong', () => {
    const schema = z.object({ a: z.number() });
    expect(parseJsonWith(schema, '{"a":2}')).toEqual({ a: 2 });
    expect(parseJsonWith(schema, '{"a":"x"}')).toBeNull();
    expect(parseJsonWith(schema, 'not json')).toBeNull();
  });
});

describe('overlapArea', () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  it('is the shared rectangle, in either box order', () => {
    expect(overlapArea(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(25);
    expect(overlapArea(box(5, 5, 10, 10), box(0, 0, 10, 10))).toBe(25);
    expect(overlapArea(box(0, 0, 10, 10), box(2, 2, 3, 3))).toBe(9);
    expect(overlapArea(box(0.1, 0.1, 0.5, 0.2), box(0.3, 0, 0.5, 0.2))).toBeCloseTo(0.03);
  });

  it('is 0 for boxes that are apart or only touch', () => {
    expect(overlapArea(box(0, 0, 10, 10), box(20, 0, 10, 10))).toBe(0);
    expect(overlapArea(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBe(0);
    expect(overlapArea(box(0, 0, 10, 10), box(0, 10, 10, 10))).toBe(0);
  });

  it('takes the inset off the shared span first', () => {
    expect(overlapArea(box(0, 0, 10, 10), box(9, 0, 10, 10), 1)).toBe(0);
    expect(overlapArea(box(0, 0, 10, 10), box(5, 5, 10, 10), 1)).toBe(16);
  });
});
