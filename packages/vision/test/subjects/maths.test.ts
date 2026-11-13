// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: the subject detector's pure maths. The letterbox puts the scaled frame top left as planar BGR with the
 * pad around it (and a mean off every value, when asked); shrinking averages; NMS keeps the best of overlapping
 * boxes; tensor boxes become clipped fractions of the frame.
 */
import { describe, expect, it } from 'vitest';
import { iou, nms, toFraction } from '../../src/subjects/boxes';
import { fitScale, letterbox, type RgbFrame } from '../../src/subjects/letterbox';

const frame = (
  width: number,
  height: number,
  pixels: readonly (readonly [number, number, number])[],
): RgbFrame => ({
  rgb: Uint8Array.from(pixels.flat()),
  width,
  height,
});

describe('letterbox', () => {
  it('puts the frame top left as B, G, R planes and pads the rest', () => {
    const out = letterbox(
      frame(2, 1, [
        [10, 20, 30],
        [40, 50, 60],
      ]),
      { width: 4, height: 4, scale: 1, pad: 114 },
    );
    expect(out.dims).toEqual([1, 3, 4, 4]);
    const plane = 16;
    expect([out.data[0], out.data[1], out.data[2]]).toEqual([30, 60, 114]);
    expect([out.data[plane], out.data[plane + 1]]).toEqual([20, 50]);
    expect([out.data[2 * plane], out.data[2 * plane + 1]]).toEqual([10, 40]);
    expect(out.data[2 * plane + 15]).toBe(114);
  });

  it('averages each block when it shrinks', () => {
    // 4 × 2 → 2 × 1: each output pixel is the mean of a 2 × 2 block.
    const out = letterbox(
      frame(4, 2, [
        [0, 0, 0],
        [100, 100, 100],
        [200, 0, 0],
        [200, 0, 0],
        [100, 100, 100],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
      { width: 2, height: 1, pad: 0 },
    );
    expect(out.scale).toBe(0.5);
    // R plane is the third.
    expect(Array.from(out.data.subarray(4, 6))).toEqual([50, 100]);
    expect(Array.from(out.data.subarray(0, 2))).toEqual([50, 0]);
  });

  it('takes the mean off every value, the pad included', () => {
    const out = letterbox(frame(1, 1, [[110, 120, 130]]), {
      width: 2,
      height: 1,
      scale: 1,
      pad: 0,
      mean: [104, 117, 123],
    });
    expect(Array.from(out.data)).toEqual([26, -104, 3, -117, -13, -123]);
  });

  it('fits the frame inside the tensor', () => {
    expect(fitScale({ width: 1280, height: 534 }, 416, 416)).toBeCloseTo(0.325);
    expect(fitScale({ width: 608, height: 1080 }, 416, 416)).toBeCloseTo(416 / 1080);
  });
});

describe('boxes', () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  it('measures overlap', () => {
    expect(iou(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBe(1);
    expect(iou(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBe(0);
    expect(iou(box(0, 0, 10, 10), box(5, 0, 10, 10))).toBeCloseTo(50 / 150);
  });

  it('keeps the best of overlapping boxes, the rest, and no more than the limit', () => {
    const kept = nms(
      [
        { box: box(1, 0, 10, 10), score: 0.7 },
        { box: box(0, 0, 10, 10), score: 0.9 },
        { box: box(50, 50, 10, 10), score: 0.6 },
        { box: box(90, 90, 10, 10), score: 0.5 },
      ],
      0.4,
    );
    expect(kept.map((c) => c.score)).toEqual([0.9, 0.6, 0.5]);
    expect(nms(kept, 0.4, 2)).toHaveLength(2);
  });

  it('turns tensor pixels into fractions of the frame, clipped to it', () => {
    const fraction = toFraction(box(-10, 10, 60, 200), 2, { width: 100, height: 50 })!;
    expect(fraction.x).toBe(0);
    expect(fraction.y).toBeCloseTo(0.1);
    expect(fraction.width).toBeCloseTo(0.25);
    expect(fraction.height).toBeCloseTo(0.9);
    expect(toFraction(box(300, 0, 10, 10), 1, { width: 100, height: 50 })).toBeNull();
  });
});
