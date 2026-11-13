// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Lattice error, not the colour-match gate: the baked 17³ cube must reproduce the Reinhard map it was
 * sampled from (SPEC P3.2: "33 only if 17 misses the ΔE gate on a ramp"). The gate itself, the graded
 * "before" scored against the "after", is grade-match.test.ts.
 */
import { unwrap, type LookStats } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { meanDeltaE } from '../../src/look/ciede2000';
import { parseCube, sampleCube, writeCube } from '../../src/look/cube-writer';
import { measureLook, type LookFrame } from '../../src/look/look-stats';
import { reinhardMap } from '../../src/look/reinhard';
import type { Rgb } from '../../src/look/colour-space';
import { GOLDEN_PAIRS } from './golden-pairs';

function latticeDelta(
  before: LookFrame,
  source: LookStats,
  target: LookStats,
): { mean: number; p95: number } {
  const lut = unwrap(
    parseCube(writeCube({ size: 17, sample: (node) => reinhardMap(node, source, target, 1) })),
  );
  const direct = new Float64Array(before.rgb.length);
  const cubed = new Float64Array(before.rgb.length);
  for (let i = 0; i < before.rgb.length; i += 3) {
    const rgb: Rgb = [
      (before.rgb[i] ?? 0) / 255,
      (before.rgb[i + 1] ?? 0) / 255,
      (before.rgb[i + 2] ?? 0) / 255,
    ];
    direct.set(reinhardMap(rgb, source, target, 1), i);
    cubed.set(sampleCube(lut, rgb), i);
  }
  return meanDeltaE(cubed, direct);
}

describe('the 17³ cube reproduces the Reinhard map (lattice error)', () => {
  it('stays within mean CIEDE2000 3 of the map on every golden pair, and an identity pair under 0.05', () => {
    expect(GOLDEN_PAIRS).toHaveLength(10);
    for (const pair of GOLDEN_PAIRS) {
      const delta = latticeDelta(
        pair.before,
        unwrap(measureLook([pair.before])),
        unwrap(measureLook([pair.after])),
      );
      expect(delta.mean, pair.name).toBeLessThanOrEqual(3);
      expect(Number.isFinite(delta.p95), pair.name).toBe(true);
    }
    const skin = GOLDEN_PAIRS[0];
    if (!skin) throw new Error('missing pair');
    const same = unwrap(measureLook([skin.before]));
    expect(latticeDelta(skin.before, same, same).mean).toBeLessThan(0.05);
  });
});
