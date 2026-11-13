// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Polarity, x-height scale and the ink-box path for digits. */
import { describe, expect, it } from 'vitest';
import { alignCrop, type InkBox } from '../../src/fonts/align';

function block(width: number, height: number, background: number, ink: InkBox, inkValue: number): Uint8Array {
  const gray = new Uint8Array(width * height).fill(background);
  for (let y = 0; y < ink.height; y++) {
    for (let x = 0; x < ink.width; x++) gray[(ink.y + y) * width + (ink.x + x)] = inkValue;
  }
  return gray;
}

const INK: InkBox = { x: 4, y: 8, width: 24, height: 16 };

describe('alignCrop', () => {
  it('flips a light-on-dark render onto a dark-on-light crop', () => {
    const crop = block(32, 32, 255, INK, 0);
    const rendered = block(32, 32, 0, INK, 255);
    const out = alignCrop(
      { gray: crop, width: 32, height: 32 },
      { gray: rendered, width: 32, height: 32, xHeight: INK.height, inkBox: INK },
      'Hello',
      'latin',
    );
    expect(out.rendered.width).toBe(out.crop.width);
    expect(out.rendered.height).toBe(out.crop.height);
    expect(out.rendered.gray[0]).toBe(255);
    expect(out.rendered.gray).toEqual(crop);
  });

  it('scales mixed-case Latin by x-height and changes the canvas size', () => {
    const crop = block(40, 40, 255, INK, 0);
    const rendered = block(40, 40, 255, INK, 0);
    const out = alignCrop(
      { gray: crop, width: 40, height: 40 },
      { gray: rendered, width: 40, height: 40, xHeight: INK.height / 2, inkBox: INK },
      'Hello',
      'latin',
    );
    expect(out.crop.width).toBe(out.rendered.width);
    expect(out.crop.height).toBe(out.rendered.height);
    expect(out.rendered.width).toBeGreaterThan(40);
  });

  it('aligns digits by ink box, ignoring a tiny x-height', () => {
    const crop = block(40, 40, 255, INK, 0);
    const rendered = block(40, 40, 255, INK, 0);
    const out = alignCrop(
      { gray: crop, width: 40, height: 40 },
      { gray: rendered, width: 40, height: 40, xHeight: 2, inkBox: INK },
      '123',
      'latin',
    );
    expect(out.crop.width).toBe(out.rendered.width);
    // Ink heights already match, so the canvas stays the crop's size. x-height would blow it up.
    expect(out.crop.width).toBeLessThan(80);
    expect(out.crop.height).toBeLessThan(80);
  });
});
