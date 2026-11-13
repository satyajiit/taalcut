// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { identityCube, parseCube, writeCube } from '../../src/grade/cube-file';
import { sampleCube } from '../../src/grade/cube-sample';
import { ANNEX_A4_CUBE, warmCube } from './fixtures';

const header = (size: number) => `LUT_3D_SIZE ${size}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n`;
const rows = (count: number) => Array.from({ length: count }, () => '0.5 0.5 0.5').join('\n');

function reasonOf(text: string, sizes?: readonly number[]): unknown {
  const parsed = parseCube(text, sizes ? { sizes } : {});
  expect(parsed.ok).toBe(false);
  if (parsed.ok) return null;
  expect(parsed.error.code).toBe('render.cube_invalid');
  return parsed.error.params?.['reason'];
}

describe('parseCube', () => {
  it('reads a 17³ cube written by writeCube, row for row', () => {
    const lut = warmCube(17);
    const parsed = parseCube(writeCube(lut));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.size).toBe(17);
    expect(parsed.value.title).toBe('Warm');
    expect(parsed.value.values.length).toBe(17 ** 3 * 3);
    for (let index = 0; index < lut.values.length; index += 997)
      expect(parsed.value.values[index]).toBeCloseTo(lut.values[index] ?? 0, 5);
  });

  it('reads the Adobe Annex A.4 size-2 example when size 2 is allowed, red fastest', () => {
    const parsed = parseCube(ANNEX_A4_CUBE, { sizes: [2] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.size).toBe(2);
    expect(parsed.value.title).toBe('Example 1');
    // Row 2 (r = 0, g = 1, b = 0) is "0 .75 0".
    expect(Array.from(parsed.value.values.slice(6, 9))).toEqual([0, 0.75, 0]);
    expect(sampleCube(parsed.value, [0, 1, 0])).toEqual([0, 0.75, 0]);
    expect(sampleCube(parsed.value, [1, 1, 1])).toEqual([1, 1, 1]);
  });

  it('refuses each malformed file with its reason, before anything runs', () => {
    expect(reasonOf(ANNEX_A4_CUBE)).toBe('sizeNotAllowed');
    expect(reasonOf(ANNEX_A4_CUBE.replaceAll('\n', '\r\n'), [2])).toBe('crlf');
    expect(reasonOf(`LUT_1D_SIZE 4\n${rows(4)}\n`)).toBe('lut1d');
    expect(reasonOf(`DOMAIN_MIN 0 0 0\n${rows(8)}\n`)).toBe('sizeMissing');
    expect(reasonOf(`LUT_3D_SIZE 2\nDOMAIN_MAX 2 2 2\n${rows(8)}\n`, [2])).toBe('domain');
    expect(reasonOf(`LUT_3D_SIZE 2\nDOMAIN_MAX 1 1\n${rows(8)}\n`, [2])).toBe('domain');
    expect(reasonOf(`${header(2)}LUT_3D_INPUT_RANGE 0 1\n${rows(8)}\n`, [2])).toBe('keyword');
    expect(reasonOf(`${header(2)}${rows(4)}\nTITLE "late"\n${rows(4)}\n`, [2])).toBe('keywordAfterData');
    expect(reasonOf(`${header(2)}${rows(7)}\n0.5 0.5\n`, [2])).toBe('rowShape');
    expect(reasonOf(`${header(2)}${rows(7)}\n0.5 NaN 0.5\n`, [2])).toBe('notFinite');
    expect(reasonOf(`${header(2)}${rows(7)}\n`, [2])).toBe('rowCount');
    expect(reasonOf(`${header(17)}${rows(9)}\n`)).toBe('rowCount');
  });

  it('leaves colours alone through an identity cube', () => {
    const lut = identityCube(17);
    for (const rgb of [
      [0.2, 0.4, 0.9],
      [0.95, 0.05, 0.5],
      [0.31, 0.31, 0.31],
    ] as const) {
      const out = sampleCube(lut, rgb);
      out.forEach((value, axis) => expect(value).toBeCloseTo(rgb[axis] ?? 0, 5));
    }
  });

  it('interpolates tetrahedrally inside a cell (Annex A.4: g pulled towards blue)', () => {
    const parsed = parseCube(ANNEX_A4_CUBE, { sizes: [2] });
    if (!parsed.ok) throw new Error('fixture');
    // g ≥ b ≥ r = 0: corners c000, c010, c011, c111 with weights 1 − g, g − b, b, 0.
    const [r, g, b] = sampleCube(parsed.value, [0, 0.6, 0.2]);
    expect(r).toBeCloseTo(0, 6);
    expect(g).toBeCloseTo(0.4 * 0.75 + 0.2 * 1, 6);
    expect(b).toBeCloseTo(0.4 * 0 + 0.2 * 1, 6);
  });
});
