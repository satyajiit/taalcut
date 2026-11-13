// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { parseCube, sampleCube, writeCube } from '../../src/look/cube-writer';

const HEADER_17 = [
  'TITLE "taalcut-reinhard"',
  'DOMAIN_MIN 0.0 0.0 0.0',
  'DOMAIN_MAX 1.0 1.0 1.0',
  'LUT_3D_SIZE 17',
].join('\n');

describe('cube writer', () => {
  it('writes the spec header, LF only, and clamps', () => {
    const text = writeCube({ sample: () => [1.4, -0.2, 0.25] });
    expect(text.startsWith(`${HEADER_17}\n`)).toBe(true);
    expect(text.includes('\r')).toBe(false);
    expect(text.endsWith('\n')).toBe(true);
    const rows = text.trimEnd().split('\n').slice(4);
    expect(rows).toHaveLength(17 ** 3);
    expect(rows[0]).toBe('1.000000 0.000000 0.250000');
    expect(rows[1]).toBe('1.000000 0.000000 0.250000');
  });

  it('orders a size-2 identity with red fastest and samples the node', () => {
    const text = writeCube({ size: 2, sample: ([r, g, b]) => [r, g, b] });
    const rows = text.trimEnd().split('\n').slice(4);
    expect(rows[0]).toBe('0.000000 0.000000 0.000000');
    expect(rows[1]).toBe('1.000000 0.000000 0.000000');
    expect(rows[2]).toBe('0.000000 1.000000 0.000000');
    expect(rows[4]).toBe('0.000000 0.000000 1.000000');
    const parsed = parseCube(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(sampleCube(parsed.value, [0, 0, 0])).toEqual([0, 0, 0]);
    expect(sampleCube(parsed.value, [1, 0, 0])).toEqual([1, 0, 0]);
    const mid = sampleCube(parsed.value, [0.25, 0.5, 0.75]);
    expect(mid[0]).toBeCloseTo(0.25, 10);
    expect(mid[1]).toBeCloseTo(0.5, 10);
    expect(mid[2]).toBeCloseTo(0.75, 10);
  });

  it('interpolates between nodes instead of snapping', () => {
    const text = writeCube({ size: 3, sample: ([r]) => [r * r, 0, 0] });
    const parsed = parseCube(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const sampled = sampleCube(parsed.value, [0.25, 0, 0]);
    expect(sampled[0]).toBeCloseTo(0.125, 6);
    expect(sampled[0]).not.toBeCloseTo(0.0625, 3);
  });

  it('round-trips a size-17 lattice through six decimals', () => {
    const text = writeCube({ size: 17, sample: ([r, g, b]) => [r * 0.5, g, Math.min(1, b + 0.1)] });
    const parsed = parseCube(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.title).toBe('taalcut-reinhard');
    expect(parsed.value.size).toBe(17);
    const node = sampleCube(parsed.value, [0.5, 0.25, 1]);
    expect(node[0]).toBeCloseTo(0.25, 5);
    expect(node[1]).toBeCloseTo(0.25, 5);
    expect(node[2]).toBeCloseTo(1, 5);
  });
});
