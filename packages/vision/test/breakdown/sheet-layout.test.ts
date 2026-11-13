// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import { tilesOf } from '../../src/breakdown/contact-sheet';
import { VISION_CONFIG } from '../../src/config';
import type { SampledFrame, VideoSource } from '../../src/media/frames';
import { composeGrid } from '../../src/media/sheet';

const SOURCE: Pick<VideoSource, 'frameCount'> = { frameCount: 300 };

describe('tilesOf', () => {
  it('puts one tile per shot on its middle frame', () => {
    expect(tilesOf({ kind: 'shots', cuts: [100, 40, 0, 400] }, SOURCE)).toEqual([
      { frame: 19 },
      { frame: 69 },
      { frame: 199 },
    ]);
    expect(tilesOf({ kind: 'shots', cuts: [] }, SOURCE)).toEqual([{ frame: 149 }]);
  });

  it('lays strips out as one row of offsets per candidate, clamped to the file', () => {
    const tiles = tilesOf({ kind: 'strips', candidates: [1, 150, 299] }, SOURCE);
    expect(tiles).toHaveLength(3 * VISION_CONFIG.strip.offsets.length);
    expect(tiles.slice(0, 5)).toEqual([0, 0, 1, 2, 3].map((frame) => ({ frame, row: 0 })));
    expect(tiles.slice(10).map((t) => t.frame)).toEqual([297, 298, 299, 299, 299]);
  });

  it('caps frames at the sheet maximum and strips at one sheet of rows', () => {
    const many = Array.from({ length: 100 }, (_, i) => i);
    expect(tilesOf({ kind: 'frames', frames: many }, SOURCE)).toHaveLength(
      VISION_CONFIG.breakdown.sheet.maxTiles,
    );
    const strips = tilesOf({ kind: 'strips', candidates: many.slice(1, 20) }, SOURCE);
    expect(strips).toHaveLength(VISION_CONFIG.strip.perSheet * VISION_CONFIG.strip.offsets.length);
  });
});

describe('composeGrid', () => {
  const tile = (value: number, width = 2, height = 2): SampledFrame => ({
    index: 0,
    width,
    height,
    data: new Uint8Array(width * height * 3).fill(value),
  });

  it('lays tiles row by row and leaves missing ones black', () => {
    const grid = composeGrid([tile(10), null, tile(30)], 2, { width: 2, height: 2 });
    expect([grid.width, grid.height]).toEqual([4, 4]);
    const at = (x: number, y: number) => grid.rgb[(y * grid.width + x) * 3];
    expect([at(0, 0), at(1, 1), at(2, 0), at(3, 1), at(0, 2), at(1, 3), at(2, 2)]).toEqual([
      10, 10, 0, 0, 30, 30, 0,
    ]);
  });

  it('centres a smaller tile in its cell', () => {
    const grid = composeGrid([tile(50, 2, 2)], 1, { width: 4, height: 2 });
    expect(Array.from({ length: 4 }, (_, x) => grid.rgb[x * 3])).toEqual([0, 50, 50, 0]);
  });

  it('routes annotated tiles through the media backend selector and event sink', () => {
    const onComputeFallback = vi.fn();
    const source = tile(50, 32, 32);
    const grid = composeGrid(
      [source],
      1,
      { width: 32, height: 32 },
      [{ highlight: true, boxes: [] }],
      { onComputeFallback },
    );
    expect(onComputeFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'media.annotateRgbTile',
        wanted: ['metal', 'webgpu'],
        reason: 'no_accelerator',
        detail: expect.stringContaining('no supported Metal or WebGPU kernel'),
      }),
    );
    expect(source.data.every((value) => value === 50)).toBe(true);
    expect(grid.rgb[0]).toBe(251);
  });
});
