// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { imageSize } from '../src/frames/image-size';

describe('imageSize', () => {
  it('reads PNG IHDR', () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write('IHDR', 12, 'latin1');
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(360, 20);
    expect(imageSize(png)).toEqual({ width: 640, height: 360 });
  });

  it('reads a JPEG SOF after other segments', () => {
    const segments = [
      'ffd8', // SOI
      'ffe0 0004 0000', // APP0, length 4
      'ffc0 0011 08 0140 00f0 03 000000000000', // SOF0: 8-bit, height 320, width 240, 3 components
    ];
    const jpeg = Buffer.from(segments.join('').replace(/ /g, ''), 'hex');
    expect(imageSize(jpeg)).toEqual({ width: 240, height: 320 });
  });

  it('rejects other data', () => {
    expect(imageSize(Buffer.from('not an image at all'))).toBeUndefined();
  });
});
