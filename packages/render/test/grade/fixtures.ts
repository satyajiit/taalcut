// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Cubes the grade tests share. */
import { cubeFromFunction, type CubeLut } from '../../src/grade/cube-file';

/**
 * The size-2 3D example of the Adobe Cube LUT Specification 1.0, Annex A.4 (red fastest): green is pulled
 * towards blue, so it is a non-linear map once interpolated tetrahedrally.
 */
export const ANNEX_A4_CUBE = [
  '# Created by: Adobe Systems Inc.',
  'TITLE "Example 1"',
  '#LUT size',
  'LUT_3D_SIZE 2',
  '#data domain',
  'DOMAIN_MIN 0.0 0.0 0.0',
  'DOMAIN_MAX 1.0 1.0 1.0',
  '#LUT data points',
  '0 0 0',
  '1 0 0',
  '0 .75 0',
  '1 .75 0',
  '0 .25 1',
  '1 .25 1',
  '0 1 1',
  '1 1 1',
  '',
].join('\n');

/** A warm, lifted look that is linear in R′G′B′, so every interpolation reproduces it exactly at 17³. */
export function warmCube(size = 17): CubeLut {
  return cubeFromFunction(size, ([r, g, b]) => [0.1 + 0.85 * r, 0.04 + 0.9 * g, 0.85 * b], 'Warm');
}
