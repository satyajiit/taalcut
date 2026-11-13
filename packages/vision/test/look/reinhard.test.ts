// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { encodedRoundTrip, encodedToRuderman, type Rgb } from '../../src/look/colour-space';
import { measureLook, type LookFrame } from '../../src/look/look-stats';
import { reinhardMap } from '../../src/look/reinhard';
import { unwrap, type LookStats } from '@taalcut/core';

function ramp(bias: readonly [number, number, number]): LookFrame {
  const width = 8;
  const height = 8;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      rgb[i] = Math.min(255, bias[0] + x * 4);
      rgb[i + 1] = Math.min(255, bias[1] + y * 3);
      rgb[i + 2] = Math.min(255, bias[2] + x);
    }
  }
  return { width, height, rgb, encoding: 'bt709' };
}

function solid(r: number, g: number, b: number): LookFrame {
  const rgb = new Uint8Array(8 * 8 * 3);
  for (let i = 0; i < 64; i++) {
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
  }
  return { width: 8, height: 8, rgb, encoding: 'bt709' };
}

function stats(frame: LookFrame): LookStats {
  return unwrap(measureLook([frame]));
}

const GREY: Rgb = [0.5, 0.5, 0.5];

describe('reinhard', () => {
  it('is identity when the looks match or strength is 0', () => {
    const source = stats(ramp([120, 130, 140]));
    const target = stats(ramp([40, 80, 200]));
    expect(reinhardMap(GREY, source, source, 1)).toEqual([0.5, 0.5, 0.5]);
    const copy: LookStats = {
      ...source,
      mean: [source.mean[0] + 1e-12, source.mean[1], source.mean[2]],
      std: [source.std[0], source.std[1], source.std[2]],
    };
    expect(reinhardMap(GREY, source, copy, 1)).toEqual([0.5, 0.5, 0.5]);
    expect(reinhardMap(GREY, source, target, 0)).toEqual([0.5, 0.5, 0.5]);
  });

  it('moves a neutral pixel toward a blue cast on the yellow–blue axis', () => {
    const source = stats(ramp([140, 140, 140]));
    const blue = stats(ramp([70, 100, 210]));
    expect(blue.mean[1]).toBeLessThan(source.mean[1]);
    const mapped = reinhardMap(GREY, source, blue, 1);
    const before = encodedToRuderman(GREY, 'bt709');
    const after = encodedToRuderman(mapped, 'bt709');
    expect(after[1]).toBeLessThan(before[1]);
    expect(mapped[2]).toBeGreaterThan(GREY[2]);
    const half = reinhardMap(GREY, source, blue, 0.5);
    expect(half[2]).toBeCloseTo(GREY[2] + 0.5 * (mapped[2] - GREY[2]), 10);
  });

  it('does not divide by a flat source deviation', () => {
    const flat = stats(solid(100, 120, 140));
    const varied = stats(ramp([20, 80, 200]));
    const pixel: Rgb = [100 / 255, 120 / 255, 140 / 255];
    const mapped = reinhardMap(pixel, flat, varied, 1);
    expect(mapped.every((channel) => Number.isFinite(channel) && Math.abs(channel) < 2)).toBe(true);
  });

  it('round-trips mid grey and a saturated red through lαβ', () => {
    for (const rgb of [
      [0.5, 0.5, 0.5],
      [1, 0, 0],
    ] as const) {
      const back = encodedRoundTrip(rgb);
      expect(Math.abs(back[0] - rgb[0])).toBeLessThan(1e-4);
      expect(Math.abs(back[1] - rgb[1])).toBeLessThan(1e-4);
      expect(Math.abs(back[2] - rgb[2])).toBeLessThan(1e-4);
    }
    const bt2020 = encodedRoundTrip([0.5, 0.5, 0.5], 'bt2020');
    expect(Math.abs(bt2020[0] - 0.5)).toBeLessThan(1e-4);
  });
});
