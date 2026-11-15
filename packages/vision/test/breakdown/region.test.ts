// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LYR1: one region of the picture read on its own (breakdown/region.ts), its pure parts on made-up pixels: the
 * region as whole pixels inside the frame, the cut-out enlarged for the engine, how much the watched picture changed
 * between two frames, and a reading put back in the whole picture's space.
 */
import { describe, expect, it } from 'vitest';
import { greyChange, greyOf, inPicture, pixelRect, regionFrame } from '../../src/breakdown/region';
import type { SampledFrame } from '../../src/media/frames';

/** A frame of one grey level, with one rectangle of another. */
function frameOf(
  width: number,
  height: number,
  level: number,
  patch?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly level: number;
  },
): SampledFrame {
  const data = new Uint8Array(width * height * 3).fill(level);
  if (patch) {
    for (let y = patch.top; y < patch.top + patch.height; y++)
      for (let x = patch.left; x < patch.left + patch.width; x++)
        data.fill(patch.level, (y * width + x) * 3, (y * width + x + 1) * 3);
  }
  return { index: 0, width, height, data } as SampledFrame;
}

describe('pixelRect', () => {
  it('covers the box in whole pixels and stays inside the frame', () => {
    expect(pixelRect({ x: 0.25, y: 0.4, width: 0.5, height: 0.1 }, 720, 1280)).toEqual({
      left: 180,
      top: 512,
      width: 360,
      height: 128,
    });
    // A box that runs off the picture is clamped to it; a sliver is at least two pixels each way.
    expect(pixelRect({ x: 0.9, y: 0.95, width: 0.5, height: 0.5 }, 100, 200)).toEqual({
      left: 90,
      top: 190,
      width: 10,
      height: 10,
    });
    expect(pixelRect({ x: 0.999, y: 0.999, width: 0.0001, height: 0.0001 }, 100, 200)).toEqual({
      left: 98,
      top: 198,
      width: 2,
      height: 2,
    });
  });
});

describe('regionFrame', () => {
  it('cuts the region out and enlarges it for the engine', () => {
    const frame = frameOf(40, 60, 10, { left: 10, top: 20, width: 20, height: 10, level: 200 });
    const cut = regionFrame(frame, { left: 10, top: 20, width: 20, height: 10 }, 2);
    expect([cut.width, cut.height]).toEqual([40, 20]);
    expect(cut.rgb).toHaveLength(40 * 20 * 3);
    // Only the patch is in it.
    expect(Math.min(...cut.rgb)).toBe(200);
    const same = regionFrame(frame, { left: 0, top: 0, width: 40, height: 60 }, 1);
    expect([same.width, same.height]).toEqual([40, 60]);
  });
});

describe('greyOf and greyChange', () => {
  it('measures how much the watched picture changed, as a share of full range', () => {
    const rect = { left: 10, top: 20, width: 20, height: 10 };
    const plain = greyOf(frameOf(40, 60, 10), rect);
    expect(plain).toHaveLength(200);
    expect(plain[0]).toBe(10);
    expect(greyChange(plain, plain)).toBe(0);
    // Half the watched pixels go from 10 to 110: a mean change of 50 levels.
    const worded = greyOf(
      frameOf(40, 60, 10, { left: 10, top: 20, width: 10, height: 10, level: 110 }),
      rect,
    );
    expect(greyChange(plain, worded)).toBeCloseTo(50 / 255, 5);
    // A change outside the watched rectangle is not counted.
    const elsewhere = greyOf(frameOf(40, 60, 10, { left: 0, top: 0, width: 8, height: 8, level: 250 }), rect);
    expect(greyChange(plain, elsewhere)).toBe(0);
    expect(greyChange(plain, new Uint8Array(3))).toBe(0);
  });
});

describe('inPicture', () => {
  it('puts a reading of the region back in the whole picture’s space', () => {
    const rect = { left: 180, top: 512, width: 360, height: 128 };
    const read = {
      text: 'Leave',
      confidence: 0.9,
      box: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 },
      quad: [
        { x: 0.25, y: 0.5 },
        { x: 0.75, y: 0.5 },
        { x: 0.75, y: 0.75 },
        { x: 0.25, y: 0.75 },
      ],
    };
    const placed = inPicture(read as never, rect, 720, 1280);
    expect(placed.text).toBe('Leave');
    expect(placed.box.x).toBeCloseTo(270 / 720, 6);
    expect(placed.box.y).toBeCloseTo(576 / 1280, 6);
    expect(placed.box.width).toBeCloseTo(180 / 720, 6);
    expect(placed.box.height).toBeCloseTo(32 / 1280, 6);
    expect(placed.quad?.[2]).toEqual({ x: 450 / 720, y: 608 / 1280 });
  });
});
