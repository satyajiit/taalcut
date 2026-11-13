// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { paintFrame, readStrip } from '../../src/render/strip';

describe('gray-code strip', () => {
  it('reads every painted frame back for clip 3, frames 0 through 7', () => {
    const width = 80;
    const height = 24;
    const cellSize = 2;
    for (let frame = 0; frame <= 7; frame += 1) {
      const rgb = paintFrame({ width, height, cellSize, frame, clipId: 3, color: '#336699' });
      expect(rgb.length).toBe(width * height * 3);
      expect(readStrip(rgb, width, height, cellSize)).toEqual({ frame, clipId: 3 });
    }
  });

  it('round-trips wider frame numbers and clip ids', () => {
    const width = 80;
    const height = 24;
    const cellSize = 2;
    for (const frame of [0, 1, 255, 256, 1023, 1800]) {
      for (const clipId of [0, 3, 255]) {
        const rgb = paintFrame({ width, height, cellSize, frame, clipId, color: '#010203' });
        expect(readStrip(rgb, width, height, cellSize)).toEqual({ frame, clipId });
      }
    }
  });
});
