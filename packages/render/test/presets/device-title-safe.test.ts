// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { canvasPreset } from '../../src/presets/canvas-preset';
import { presetFor, safeRectFor, titleSafe } from '../../src/presets/presets.v1';

describe('camera-roll title alignment', () => {
  it.each(['device', 'deviceHevc', 'deviceAv1'] as const)(
    '%s uses the same symmetric margins at every canvas size',
    (id) => {
      for (const canvas of [
        { width: 1080, height: 1920 },
        { width: 2160, height: 3840 },
        { width: 1080, height: 1080 },
      ]) {
        const preset = canvasPreset(presetFor(id), canvas);
        expect(preset.safe).toEqual(titleSafe(canvas.width, canvas.height));
        expect(preset.safe.x + preset.safe.width / 2).toBe(canvas.width / 2);
        expect(preset.overlays).toEqual([]);
      }
    },
  );

  it('keeps an airport title centered without treating it as social-app UI overlap', () => {
    const box = { x: 287, y: 532, width: 506, height: 71 };
    const safe = presetFor('device').safe;
    expect(box.x + box.width / 2).toBe(540);
    expect(box.x).toBeGreaterThanOrEqual(safe.x);
    expect(box.x + box.width).toBeLessThanOrEqual(safe.x + safe.width);
    expect(box.y + box.height).toBeLessThanOrEqual(safe.y + safe.height);
    const platforms = ['shorts', 'reels', 'tiktok'] as const;
    expect(safeRectFor([...platforms, 'device'])).toEqual(safeRectFor(platforms));
    for (const id of platforms) expect(presetFor(id).overlays.length).toBeGreaterThan(0);
  });
});
