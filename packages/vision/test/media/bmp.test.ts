// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { encodeBmp } from '../../src/media/bmp';

/** Reads back a 24-bit bottom-up BI_RGB BMP as rgb24, as ImageIO would. */
function decode(bytes: Buffer): { width: number; height: number; rgb: Uint8Array } {
  expect(bytes.toString('ascii', 0, 2)).toBe('BM');
  expect(bytes.readUInt32LE(2)).toBe(bytes.length);
  const offset = bytes.readUInt32LE(10);
  const width = bytes.readInt32LE(18);
  const height = bytes.readInt32LE(22);
  expect([bytes.readUInt16LE(26), bytes.readUInt16LE(28), bytes.readUInt32LE(30)]).toEqual([1, 24, 0]);
  const stride = Math.ceil((width * 3) / 4) * 4;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const src = offset + (height - 1 - y) * stride + x * 3;
      rgb.set([bytes[src + 2] ?? -1, bytes[src + 1] ?? -1, bytes[src] ?? -1], (y * width + x) * 3);
    }
  return { width, height, rgb };
}

describe('encodeBmp', () => {
  it('round-trips rgb24 pixels, padding rows to four bytes', () => {
    for (const [width, height] of [
      [1, 1],
      [3, 2],
      [5, 3],
      [8, 4],
    ] as const) {
      const rgb = Uint8Array.from({ length: width * height * 3 }, (_, i) => (i * 37 + 11) % 256);
      const bytes = encodeBmp(rgb, width, height);
      expect(bytes.length).toBe(54 + Math.ceil((width * 3) / 4) * 4 * height);
      expect(decode(bytes)).toEqual({ width, height, rgb });
    }
  });

  it('refuses a bad size or too few pixels', () => {
    expect(() => encodeBmp(new Uint8Array(12), 0, 4)).toThrow(RangeError);
    expect(() => encodeBmp(new Uint8Array(5), 2, 1)).toThrow(RangeError);
  });
});
