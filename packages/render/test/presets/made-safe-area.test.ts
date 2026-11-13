// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-MAKE: timeline assembly keeps a made portrait video's overlays inside a copy of the device preset's safe
 * rect (symmetric title margins for a device copy), since timeline can't import render. This
 * holds the copy to the presets, so a new safe-zone version can't leave assembly placing overlays QA then fails.
 */
import { MADE_CANVAS_SIZES, MADE_SAFE_AREAS } from '@taalcut/timeline';
import { describe, expect, it } from 'vitest';
import { EXPORT_PRESETS } from '../../src/presets/presets.v1';

describe("assembly's safe area for a made portrait video", () => {
  it('is the device preset’s safe rect, as shares of its frame', () => {
    const device = EXPORT_PRESETS.find((preset) => preset.id === 'device')!;
    expect(MADE_CANVAS_SIZES.portrait).toEqual({ width: device.width, height: device.height });
    const safe = MADE_SAFE_AREAS.portrait;
    expect(safe.x * device.width).toBeCloseTo(device.safe.x, 6);
    expect(safe.y * device.height).toBeCloseTo(device.safe.y, 6);
    expect(safe.width * device.width).toBeCloseTo(device.safe.width, 6);
    expect(safe.height * device.height).toBeCloseTo(device.safe.height, 6);
  });
});
