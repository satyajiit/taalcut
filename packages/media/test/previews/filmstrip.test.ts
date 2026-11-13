// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The filmstrip's frame count, cells and times (UX2, recipe 2), with no FFmpeg. */
import { FILMSTRIP_MAX_FRAMES, RationalTime } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { FILMSTRIP_TILE_HEIGHT, filmstripFrameCount, filmstripLayout } from '@taalcut/media';
import { videoPlan } from '../helpers/video-plan';

/** A 30 fps plan of `frames` frames, `width` × `height` upright. */
function plan(width: number, height: number, frames: number) {
  const base = videoPlan({
    duration: { value: frames / 30, rate: 1 },
    frameCount: frames,
    width,
    height,
    displayWidth: width,
    displayHeight: height,
  });
  return { ...base, frames, duration: RationalTime.of(frames, base.frameRate.output) };
}

describe('filmstripFrameCount', () => {
  it('gives one frame for each slot of the widest strip, by the clip’s shape', () => {
    expect(filmstripFrameCount(16 / 9, 10_000)).toBe(20);
    expect(filmstripFrameCount(4 / 3, 10_000)).toBe(26);
    expect(filmstripFrameCount(1, 10_000)).toBe(35);
    expect(filmstripFrameCount(9 / 16, 10_000)).toBe(61);
    // The narrowest slot is 24 px: a very tall clip stops at the most a sprite holds.
    expect(filmstripFrameCount(9 / 21, 10_000)).toBe(FILMSTRIP_MAX_FRAMES);
    expect(filmstripFrameCount(1 / 10, 10_000)).toBe(FILMSTRIP_MAX_FRAMES);
  });

  it('never gives more frames than the clip has, nor fewer than one', () => {
    expect(filmstripFrameCount(9 / 16, 3)).toBe(3);
    expect(filmstripFrameCount(16 / 9, 0)).toBe(1);
  });
});

describe('filmstripLayout', () => {
  it('lays a 16:9 clip’s 20 frames, 192 px high, from its first frame to its last', () => {
    const layout = filmstripLayout(plan(1920, 1080, 600));
    expect(layout.tiles).toHaveLength(20);
    expect([layout.tileWidth, layout.tileHeight]).toEqual([340, FILMSTRIP_TILE_HEIGHT]);
    expect([layout.columns, layout.rows]).toEqual([5, 4]);
    expect([layout.width, layout.height]).toEqual([5 * 340, 4 * 192]);
    expect(layout.tiles[0]).toMatchObject({ frame: 0, x: 0, y: 0 });
    expect(layout.tiles[6]).toMatchObject({ x: 340, y: 192 });
    expect(layout.tiles.at(-1)?.frame).toBe(599);
    expect(RationalTime.toSeconds(layout.tiles.at(-1)!.time)).toBeCloseTo(599 / 30, 6);
  });

  it('keeps every sprite near 1.3 megapixels, whatever the clip’s shape', () => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [1440, 1080],
      [1080, 1080],
      [720, 1680],
    ] as const) {
      const layout = filmstripLayout(plan(width, height, 18_000));
      const pixels = layout.tiles.length * layout.tileWidth * layout.tileHeight;
      expect(pixels, `${width}×${height}`).toBeGreaterThan(1_150_000);
      expect(pixels, `${width}×${height}`).toBeLessThan(1_400_000);
    }
  });

  it('never makes a frame taller than the clip, and uses every frame of a very short one', () => {
    const tiny = filmstripLayout(plan(160, 90, 3));
    expect(tiny.tileHeight).toBe(90);
    expect(tiny.tiles.map((tile) => tile.frame)).toEqual([0, 1, 2]);
    expect(tiny.columns * tiny.rows).toBeGreaterThanOrEqual(3);
  });
});
