// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-MAKE: timeline assembly keeps a made portrait video's overlays inside a copy of the device preset's safe
 * rect (symmetric title margins for a device copy), since timeline can't import render. This
 * holds the copy to the presets, so a new safe-zone version can't leave assembly placing overlays QA then fails.
 *
 * TXT1: timeline's text tools report, as facts for whoever places the text, the part of a vertical frame each
 * platform's own interface leaves clear (`PLATFORM_CLEAR_AREAS`): a copy of the safe-zones file, held to it here.
 * The file says of itself that it is provisional (`checkedOn: null`); when the zones are matched to the apps, this
 * fails until the copy and its words follow.
 */
import { MADE_CANVAS_SIZES, MADE_SAFE_AREAS, PLATFORM_CLEAR_AREAS, PLATFORM_FRAME } from '@taalcut/timeline';
import { describe, expect, it } from 'vitest';
import { EXPORT_PRESETS } from '../../src/presets/presets.v1';
import zones from '../../src/presets/safe-zones.v1.json';

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

describe('the platforms’ clear areas the text tools report (TXT1)', () => {
  it('are the safe-zones file’s, platform by platform, and still provisional', () => {
    expect(PLATFORM_FRAME).toEqual(zones.canvas);
    expect(Object.keys(PLATFORM_CLEAR_AREAS).sort()).toEqual(Object.keys(zones.platforms).sort());
    for (const [platform, area] of Object.entries(PLATFORM_CLEAR_AREAS))
      expect(area).toEqual(zones.platforms[platform as keyof typeof zones.platforms].safe);
    expect(zones.checkedOn).toBeNull();
  });
});
