// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tetrahedral interpolation of a 3D LUT (Adobe Cube LUT 1.0 section 8, and FFmpeg lut3d's default): the
 * lattice cell around a colour is split into six tetrahedra by the order of its fractional coordinates, and
 * the colour is the barycentric mix of that tetrahedron's four corners. Used to compute what a graded frame
 * should look like (tests, evals) and to resample a table to another size.
 */
import type { CubeLut, Rgb } from './cube-file';

function corner(lut: CubeLut, r: number, g: number, b: number): Rgb {
  const at = (r + lut.size * g + lut.size * lut.size * b) * 3;
  return [lut.values[at] ?? 0, lut.values[at + 1] ?? 0, lut.values[at + 2] ?? 0];
}

const mix = (weights: readonly (readonly [number, Rgb])[]): Rgb => {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [weight, value] of weights) {
    r += weight * value[0];
    g += weight * value[1];
    b += weight * value[2];
  }
  return [r, g, b];
};

/** The table's output for an input colour in the domain (0–1 R′G′B′; outside values are clamped). */
export function sampleCube(lut: CubeLut, rgb: Rgb): Rgb {
  const last = lut.size - 1;
  const scaled = rgb.map((value, axis) => {
    const min = lut.domainMin[axis] ?? 0;
    const max = lut.domainMax[axis] ?? 1;
    return Math.min(Math.max((value - min) / (max - min), 0), 1) * last;
  });
  const [sr, sg, sb] = [scaled[0] ?? 0, scaled[1] ?? 0, scaled[2] ?? 0];
  const [r0, g0, b0] = [Math.floor(sr), Math.floor(sg), Math.floor(sb)];
  const [r1, g1, b1] = [Math.min(r0 + 1, last), Math.min(g0 + 1, last), Math.min(b0 + 1, last)];
  const [dr, dg, db] = [sr - r0, sg - g0, sb - b0];
  const c000 = corner(lut, r0, g0, b0);
  const c111 = corner(lut, r1, g1, b1);
  if (dr > dg) {
    if (dg > db)
      return mix([
        [1 - dr, c000],
        [dr - dg, corner(lut, r1, g0, b0)],
        [dg - db, corner(lut, r1, g1, b0)],
        [db, c111],
      ]);
    if (dr > db)
      return mix([
        [1 - dr, c000],
        [dr - db, corner(lut, r1, g0, b0)],
        [db - dg, corner(lut, r1, g0, b1)],
        [dg, c111],
      ]);
    return mix([
      [1 - db, c000],
      [db - dr, corner(lut, r0, g0, b1)],
      [dr - dg, corner(lut, r1, g0, b1)],
      [dg, c111],
    ]);
  }
  if (db > dg)
    return mix([
      [1 - db, c000],
      [db - dg, corner(lut, r0, g0, b1)],
      [dg - dr, corner(lut, r0, g1, b1)],
      [dr, c111],
    ]);
  if (db > dr)
    return mix([
      [1 - dg, c000],
      [dg - db, corner(lut, r0, g1, b0)],
      [db - dr, corner(lut, r0, g1, b1)],
      [dr, c111],
    ]);
  return mix([
    [1 - dg, c000],
    [dg - dr, corner(lut, r0, g1, b0)],
    [dr - db, corner(lut, r1, g1, b0)],
    [db, c111],
  ]);
}
