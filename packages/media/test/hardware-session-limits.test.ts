// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-S5: the hardware session cap by video engine and tier. Macs keep their caps; NVIDIA follows NVENC's
 * consumer limit of 8 per system; other vendors stay conservative. The Windows rows have not run on real
 * hardware.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HARDWARE_SESSION_LIMIT,
  ENGINE_SESSION_LIMITS,
  HARDWARE_SESSION_LIMITS,
  HARDWARE_VIDEO_ENGINES,
  hardwareSessionLimit,
} from '../src/index';

describe('hardwareSessionLimit', () => {
  it('keeps the Mac caps per tier (VideoToolbox), and the lowest when the hardware is unknown', () => {
    expect(HARDWARE_SESSION_LIMITS).toEqual({ minimum: 2, recommended: 3, high: 4 });
    for (const tier of ['minimum', 'recommended', 'high'] as const)
      expect(hardwareSessionLimit({ engine: 'videotoolbox', tier })).toBe(HARDWARE_SESSION_LIMITS[tier]);
    expect(hardwareSessionLimit(undefined)).toBe(2);
    expect(DEFAULT_HARDWARE_SESSION_LIMIT).toBe(2);
  });

  it('caps NVIDIA at NVENC’s 8 sessions per system and other engines conservatively, whatever the tier', () => {
    expect(ENGINE_SESSION_LIMITS).toEqual({ nvidia: 8, intel: 2, amd: 2, vaapi: 2, none: 1 });
    for (const tier of ['minimum', 'recommended', 'high'] as const) {
      expect(hardwareSessionLimit({ engine: 'nvidia', tier })).toBe(8);
      expect(hardwareSessionLimit({ engine: 'intel', tier })).toBe(2);
      expect(hardwareSessionLimit({ engine: 'amd', tier })).toBe(2);
      expect(hardwareSessionLimit({ engine: 'none', tier })).toBe(1);
    }
  });

  it('has a cap for every engine, never more than NVENC allows', () => {
    for (const engine of HARDWARE_VIDEO_ENGINES) {
      const limit = hardwareSessionLimit({ engine, tier: 'high' });
      expect(limit).toBeGreaterThanOrEqual(1);
      expect(limit).toBeLessThanOrEqual(8);
    }
  });
});
