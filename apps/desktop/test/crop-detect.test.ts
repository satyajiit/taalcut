// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The crop scan's arithmetic on hand-made gray frames: no FFmpeg. */
import { describe, expect, it } from 'vitest';
import { createCropScan, heaviestRun, toSourceBox, type PixelBox } from '../src/utility/roots/crop-detect';

const W = 100;
const H = 200;

/** A gray frame: `base` everywhere, `value` inside each box. */
function frame(base: number, boxes: readonly (PixelBox & { readonly value: number })[] = []): Uint8Array {
  const data = new Uint8Array(W * H).fill(base);
  for (const box of boxes)
    for (let y = box.y; y < box.y + box.height; y++)
      data.fill(box.value, y * W + box.x, y * W + box.x + box.width);
  return data;
}

const reel = { x: 10, y: 40, width: 80, height: 120 };

describe('heaviestRun', () => {
  it('bridges short gaps and keeps the band with the most weight', () => {
    // A light band (a clock) at 0–1, a gap of 5, then the heavy band at 7–15 with a 1-long hole.
    const weights = [3, 3, 0, 0, 0, 0, 0, 9, 9, 9, 0, 9, 9, 9, 9];
    expect(heaviestRun(weights, 1, 1)).toEqual({ start: 7, end: 15 });
    expect(heaviestRun(weights, 1, 5)).toEqual({ start: 0, end: 15 });
    expect(heaviestRun(weights, 1, 0)).toEqual({ start: 11, end: 15 });
    expect(heaviestRun([0, 0, 0], 1, 2)).toBeNull();
    expect(heaviestRun([], 1, 2)).toBeNull();
  });
});

describe('createCropScan', () => {
  it('finds the reel that changes between samples inside static chrome', () => {
    const scan = createCropScan(W, H);
    const chrome = { x: 0, y: 0, width: W, height: 30, value: 200 };
    expect(scan.add(frame(230, [chrome, { ...reel, value: 60 }]))).toBe(true);
    expect(scan.add(frame(230, [chrome, { ...reel, value: 180 }]))).toBe(true);
    expect(scan.box()).toEqual(reel);
  });

  it('ignores a status-bar clock that changes once, away from the reel', () => {
    const scan = createCropScan(W, H);
    const clock = { x: 80, y: 4, width: 12, height: 8 };
    scan.add(
      frame(230, [
        { ...reel, value: 40 },
        { ...clock, value: 20 },
      ]),
    );
    scan.add(
      frame(230, [
        { ...reel, value: 200 },
        { ...clock, value: 20 },
      ]),
    );
    scan.add(
      frame(230, [
        { ...reel, value: 40 },
        { ...clock, value: 120 },
      ]),
    );
    expect(scan.box()).toEqual(reel);
  });

  it('keeps letterbox bars out: the box is the lit picture that moves', () => {
    const picture = { x: 0, y: 50, width: W, height: 100 };
    const scan = createCropScan(W, H);
    scan.add(frame(16, [{ ...picture, value: 90 }]));
    scan.add(frame(16, [{ ...picture, value: 200 }]));
    expect(scan.box()).toEqual(picture);
  });

  it('answers the whole frame (null) when everything moves, nothing moves, or only a spinner moves', () => {
    const all = createCropScan(W, H);
    all.add(frame(40));
    all.add(frame(200));
    expect(all.box()).toBeNull();

    const still = createCropScan(W, H);
    still.add(frame(120, [{ ...reel, value: 60 }]));
    still.add(frame(120, [{ ...reel, value: 60 }]));
    expect(still.box()).toBeNull();

    const spinner = createCropScan(W, H);
    const dot = { x: 45, y: 95, width: 10, height: 10 };
    spinner.add(frame(230, [{ ...dot, value: 30 }]));
    spinner.add(frame(230, [{ ...dot, value: 200 }]));
    expect(spinner.box()).toBeNull();

    const one = createCropScan(W, H);
    one.add(frame(230, [{ ...reel, value: 60 }]));
    expect(one.box()).toBeNull();
  });

  it('refuses a frame of the wrong size without counting it', () => {
    const scan = createCropScan(W, H);
    expect(scan.add(new Uint8Array(W * H - 1))).toBe(false);
    expect(scan.add(frame(230, [{ ...reel, value: 60 }]))).toBe(true);
    expect(scan.add(frame(230, [{ ...reel, value: 180 }]))).toBe(true);
    expect(scan.box()).toEqual(reel);
  });

  it('counts small changes (compression noise) as still', () => {
    const scan = createCropScan(W, H);
    scan.add(frame(230, [{ ...reel, value: 100 }]));
    scan.add(frame(230, [{ ...reel, value: 124 }]));
    expect(scan.box()).toBeNull();
  });
});

describe('toSourceBox', () => {
  it('scales up to even source pixels and stays inside the frame', () => {
    expect(toSourceBox(reel, { width: W, height: H }, { width: 1080, height: 2160 })).toEqual({
      x: 108,
      y: 432,
      width: 864,
      height: 1296,
    });
    // Odd scale factors round to the nearest even pixel; the right and bottom edges clamp to the even frame.
    expect(
      toSourceBox(
        { x: 3, y: 0, width: 97, height: 200 },
        { width: W, height: H },
        { width: 333, height: 667 },
      ),
    ).toEqual({ x: 10, y: 0, width: 322, height: 666 });
  });
});
