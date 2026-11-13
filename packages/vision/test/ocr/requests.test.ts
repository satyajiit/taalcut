// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { requestRanges, requestSizes } from '../../src/ocr/requests';

describe('requestSizes (IX3-O2)', () => {
  it.each([
    [0, []],
    [1, [1]],
    [2, [1, 1]],
    [13, [7, 6]],
    [16, [8, 8]],
    [25, [13, 12]],
    [32, [16, 16]],
    [33, [9, 8, 8, 8]],
    [45, [12, 11, 11, 11]],
    [70, [12, 12, 12, 12, 11, 11]],
  ])('%i frames, two in flight → %j', (count, sizes) => {
    expect(requestSizes(count, 2, 16)).toEqual(sizes);
  });

  it('fills whole rounds of the requests in flight, never above the helper’s 16 frames', () => {
    for (let count = 1; count <= 200; count++) {
      for (const inFlight of [1, 2, 3]) {
        const sizes = requestSizes(count, inFlight, 16);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(count);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(16);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        // As few rounds as 16-frame requests need; a full round unless there are fewer frames than slots.
        expect(Math.ceil(sizes.length / inFlight)).toBe(Math.ceil(Math.ceil(count / 16) / inFlight));
        if (count >= inFlight) expect(sizes.length % inFlight).toBe(0);
      }
    }
  });

  it('keeps one request in flight as 16-frame pieces', () => {
    expect(requestSizes(40, 1, 16)).toEqual([14, 13, 13]);
  });

  it('gives the ranges in frame order, covering every frame once', () => {
    expect(requestRanges(13, 2, 16)).toEqual([
      [0, 7],
      [7, 13],
    ]);
    expect(requestRanges(0, 2, 16)).toEqual([]);
  });
});
