// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Round IX3's shared helpers (IX3-I4): copies two or three packages each kept. */
import { describe, expect, it } from 'vitest';
import { chunk, float32sFrom, sumFields } from '../src/index';

describe('chunk', () => {
  it('cuts items into runs of the size, in order, the last one shorter', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk(['a', 'b'], 2)).toEqual([['a', 'b']]);
    expect(chunk(['a'], 64)).toEqual([['a']]);
    expect(chunk([], 3)).toEqual([]);
  });

  it('returns new arrays and leaves the input alone', () => {
    const items = [1, 2, 3];
    const [run] = chunk(items, 3);
    expect(run).not.toBe(items);
    run?.push(4);
    expect(run).toEqual([1, 2, 3, 4]);
    expect(items).toEqual([1, 2, 3]);
  });

  it('throws on a size that is not a positive integer (a bug)', () => {
    for (const size of [0, -1, 1.5, Number.NaN]) expect(() => chunk([1], size)).toThrow(RangeError);
  });
});

describe('sumFields (core-requests-shotproc C2)', () => {
  it('sums each key over the items', () => {
    const items = [
      { cuts: 2, found: 1, label: 'a' },
      { cuts: 3, found: 3, label: 'b' },
    ];
    expect(sumFields(items, ['cuts', 'found'])).toEqual({ cuts: 5, found: 4 });
  });

  it('gives 0 for every key over no items, and only the keys asked for', () => {
    expect(sumFields<'a' | 'b'>([], ['a', 'b'])).toEqual({ a: 0, b: 0 });
    const both: { a: number; b: number }[] = [{ a: 1, b: 2 }];
    expect(sumFields(both, ['a'])).toEqual({ a: 1 });
  });
});

describe('float32sFrom (core-requests-shotproc C3)', () => {
  const bytesOf = (values: readonly number[]) => new Uint8Array(Float32Array.from(values).buffer);

  it('reads exactly count float32', () => {
    expect(Array.from(float32sFrom(bytesOf([1.5, -2, 0.25]), 3) ?? [])).toEqual([1.5, -2, 0.25]);
    expect(float32sFrom(new Uint8Array(0), 0)).toEqual(new Float32Array(0));
  });

  it('gives undefined for any other length or a bad count', () => {
    const bytes = bytesOf([1, 2]);
    expect(float32sFrom(bytes, 1)).toBeUndefined();
    expect(float32sFrom(bytes, 3)).toBeUndefined();
    expect(float32sFrom(bytes.subarray(0, 7), 2)).toBeUndefined();
    expect(float32sFrom(bytes, -2)).toBeUndefined();
    expect(float32sFrom(bytes, 1.5)).toBeUndefined();
  });

  it('copies bytes that start at an odd offset into an aligned buffer of its own', () => {
    const pooled = new Uint8Array(1 + 8);
    pooled.set(bytesOf([3, 4]), 1);
    const view = pooled.subarray(1);
    const out = float32sFrom(view, 2);
    expect(Array.from(out ?? [])).toEqual([3, 4]);
    pooled.fill(0);
    expect(Array.from(out ?? [])).toEqual([3, 4]);
  });
});
