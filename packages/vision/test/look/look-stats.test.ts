// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { lookStatsSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { LookUnavailable } from '../../src/look/errors';
import { measureLook, type LookFrame } from '../../src/look/look-stats';

function frame(
  fill: (x: number, y: number) => readonly [number, number, number],
  extra: Partial<LookFrame> = {},
): LookFrame {
  const width = extra.width ?? 8;
  const height = extra.height ?? 8;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * width + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
  return { width, height, rgb, encoding: 'bt709', ...extra, ...(extra.rgb ? { rgb: extra.rgb } : {}) };
}

function solid(r: number, g: number, b: number, extra: Partial<LookFrame> = {}): LookFrame {
  return frame(() => [r, g, b], extra);
}

describe('measureLook', () => {
  it('moves the yellow–blue axis down for a blue cast and parses as look stats', () => {
    const neutral = measureLook([frame((x) => [140 + x, 140, 140 - x])]);
    const blue = measureLook([frame((x) => [80 + x, 110, 210 - x])]);
    expect(neutral.ok && blue.ok).toBe(true);
    if (!neutral.ok || !blue.ok) return;
    expect(lookStatsSchema.safeParse(blue.value).success).toBe(true);
    // α (index 1) is Ruderman yellow–blue: more blue cone, smaller α. β is red–green.
    expect(blue.value.mean[1]).toBeLessThan(neutral.value.mean[1] - 0.2);
    expect(Math.abs(blue.value.mean[1] - neutral.value.mean[1])).toBeGreaterThan(
      Math.abs(blue.value.mean[2] - neutral.value.mean[2]),
    );
    expect(blue.value.frames).toBe(1);
    expect(blue.value.pixels).toBe(64);
    expect(blue.value.encoding).toBe('bt709');
  });

  it('expands limited-range code values before the statistic', () => {
    const full = measureLook([solid(235, 235, 235)]);
    const limited = measureLook([solid(235, 235, 235, { range: 'limited' })]);
    const fullBlack = measureLook([solid(16, 16, 16)]);
    const limitedBlack = measureLook([solid(16, 16, 16, { range: 'limited' })]);
    expect(full.ok && limited.ok && fullBlack.ok && limitedBlack.ok).toBe(true);
    if (!full.ok || !limited.ok || !fullBlack.ok || !limitedBlack.ok) return;
    expect(limited.value.mean[0]).toBeGreaterThan(full.value.mean[0]);
    expect(limitedBlack.value.mean[0]).toBeLessThan(fullBlack.value.mean[0]);
  });

  it('drops frames flagged dark and frames under the 5th percentile', () => {
    const bright = frame((x) => [200, 140 + x, 120]);
    const dark = solid(1, 1, 1);
    const flagged = frame((x) => [200, 140 + x, 120], { dark: true });
    const measured = measureLook([bright, bright, dark, flagged]);
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    expect(measured.value.frames).toBe(2);
    expect(measured.value.pixels).toBe(128);
  });

  it('returns LookUnavailable for an empty set, a bad buffer, and only dark frames', () => {
    const empty = measureLook([]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(LookUnavailable.is(empty.error)).toBe(true);
    const bad = measureLook([{ width: 2, height: 2, rgb: new Uint8Array(3), encoding: 'bt709' }]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(LookUnavailable.is(bad.error)).toBe(true);
    const dark = measureLook([solid(4, 4, 4, { dark: true })]);
    expect(dark.ok).toBe(false);
    if (!dark.ok) expect(dark.error.retryable).toBe(false);
  });
});
