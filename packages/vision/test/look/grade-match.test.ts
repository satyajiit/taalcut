// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The P3-V17 colour gate (SPEC P3.2): target = the "after" statistics, source = the "before" statistics,
 * bake the 17³ cube, apply it to the "before" pixels with the CPU route (tetrahedral `sampleCube`), and
 * score the graded picture against the "after" with per-pixel CIEDE2000 on the 64×36 grid. Gate: mean ≤ 3.0.
 *
 * Done-when is NOT met: the gate holds on seven of the ten generated pairs. The three misses (saturated,
 * teal-orange, chart) are hue rotations or cross-channel shifts. A global Reinhard transfer scales and
 * offsets each lαβ axis on its own, so it cannot rotate hue. They are pinned below so a change of
 * estimator shows up here. Whether those looks are out of scope for v1 is the PO's call (SPEC P3.6).
 */
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { meanDeltaE, type DeltaESummary } from '../../src/look/ciede2000';
import { parseCube, sampleCube, writeCube } from '../../src/look/cube-writer';
import { measureLook } from '../../src/look/look-stats';
import { reinhardMap } from '../../src/look/reinhard';
import { GOLDEN_PAIRS, unitRgb, type GoldenPair } from './golden-pairs';

const GATE = 3.0;
/** A global per-axis transfer cannot express these grades (hue rotation, cross-channel mix). */
const KNOWN_MISSES = ['saturated', 'teal-orange', 'chart'];

interface Scored {
  readonly name: string;
  readonly ungraded: DeltaESummary;
  readonly matched: DeltaESummary;
}

function score(pair: GoldenPair): Scored {
  const source = unwrap(measureLook([pair.before]));
  const target = unwrap(measureLook([pair.after]));
  const lut = unwrap(
    parseCube(writeCube({ size: 17, sample: (node) => reinhardMap(node, source, target, 1) })),
  );
  const before = unitRgb(pair.before);
  const graded = new Float64Array(before.length);
  for (let i = 0; i < before.length; i += 3) {
    graded.set(sampleCube(lut, [before[i] ?? 0, before[i + 1] ?? 0, before[i + 2] ?? 0]), i);
  }
  const after = unitRgb(pair.after);
  return { name: pair.name, ungraded: meanDeltaE(before, after), matched: meanDeltaE(graded, after) };
}

const SCORES = GOLDEN_PAIRS.map(score);

describe('colour match gate: the graded before against the after', () => {
  it('scores all ten generated pairs', () => {
    expect(SCORES.map((entry) => entry.name)).toEqual([
      'skin',
      'sky',
      'foliage',
      'grey ramp',
      'saturated',
      'dark',
      'teal-orange',
      'pastel',
      'tungsten',
      'chart',
    ]);
    for (const entry of SCORES) {
      expect(Number.isFinite(entry.matched.mean), entry.name).toBe(true);
      expect(Number.isFinite(entry.matched.p95), entry.name).toBe(true);
    }
  });

  it('holds mean CIEDE2000 ≤ 3.0 on the seven pairs a per-axis transfer can express', () => {
    const within = SCORES.filter((entry) => !KNOWN_MISSES.includes(entry.name));
    expect(within).toHaveLength(7);
    for (const entry of within) expect(entry.matched.mean, entry.name).toBeLessThanOrEqual(GATE);
  });

  it('moves every pair closer to its after than the ungraded before was', () => {
    for (const entry of SCORES) expect(entry.matched.mean, entry.name).toBeLessThan(entry.ungraded.mean);
  });

  it('misses the gate on the three hue-shift pairs (characterisation, not a pass)', () => {
    const misses = SCORES.filter((entry) => entry.matched.mean > GATE).map((entry) => entry.name);
    expect(misses).toEqual(KNOWN_MISSES);
  });
});
