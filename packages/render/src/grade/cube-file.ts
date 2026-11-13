// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Adobe Cube LUT 1.0 (Adobe Systems, "Cube LUT Specification", version 1.0, 2013): the reader and validator
 * every grade passes before an encode starts, and the writer tests and evals use. Render reads 3D tables only,
 * over the unit domain, in the order the spec fixes (index r + N·g + N²·b: red fastest, blue slowest; the
 * order can't be checked from the numbers, so it is the file's promise, as it is for Core Image and lut3d).
 * Lines end in LF; a CR anywhere is refused (section 5.3).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { err, LUT_CUBE_SIZES, ok, type AsyncResult, type Result } from '@taalcut/core';
import { CubeInvalid } from '../errors-phase3';

export type Rgb = readonly [number, number, number];

export interface CubeLut {
  readonly size: number;
  readonly title: string | null;
  readonly domainMin: Rgb;
  readonly domainMax: Rgb;
  /** size³ rows of r, g, b; row index r + N·g + N²·b. */
  readonly values: Float32Array;
}

export interface ParseCubeOptions {
  /** Edge sizes accepted. Default core's LUT_CUBE_SIZES (17 and 33). */
  readonly sizes?: readonly number[];
}

/** Why a cube was refused: `render.cube_invalid`'s `reason`. */
export const CUBE_PROBLEMS = [
  'crlf',
  'lut1d',
  'sizeMissing',
  'sizeNotAllowed',
  'domain',
  'keyword',
  'keywordAfterData',
  'rowShape',
  'notFinite',
  'rowCount',
  'unreadable',
] as const;
export type CubeProblem = (typeof CUBE_PROBLEMS)[number];

const invalid = (reason: CubeProblem, detail?: string) =>
  err(CubeInvalid({ reason }, detail ? { detail: detail.slice(0, 200) } : {}));

function triple(fields: readonly string[]): Rgb | null {
  if (fields.length !== 3) return null;
  const numbers = fields.map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0];
}

const isUnit = (min: Rgb, max: Rgb) => min.every((value) => value === 0) && max.every((value) => value === 1);

/** Parses and validates a `.cube` file's text. */
export function parseCube(text: string, options: ParseCubeOptions = {}): Result<CubeLut> {
  if (text.includes('\r')) return invalid('crlf');
  const sizes = options.sizes ?? LUT_CUBE_SIZES;
  let size: number | null = null;
  let title: string | null = null;
  let domainMin: Rgb = [0, 0, 0];
  let domainMax: Rgb = [1, 1, 1];
  const rows: number[] = [];
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const fields = line.split(/\s+/u);
    const keyword = fields[0] ?? '';
    if (/^[A-Z]/u.test(keyword)) {
      // Keywords come before the table (section 5.4).
      if (rows.length > 0) return invalid('keywordAfterData', `line ${index + 1}`);
      if (keyword === 'TITLE') {
        title = line.slice('TITLE'.length).trim().replace(/^"|"$/gu, '').slice(0, 200);
      } else if (keyword === 'LUT_1D_SIZE') {
        return invalid('lut1d');
      } else if (keyword === 'LUT_3D_SIZE') {
        const value = Number(fields[1]);
        if (fields.length !== 2 || !Number.isInteger(value)) return invalid('sizeMissing', line);
        if (!sizes.includes(value)) return invalid('sizeNotAllowed', String(value));
        size = value;
      } else if (keyword === 'DOMAIN_MIN' || keyword === 'DOMAIN_MAX') {
        const parsed = triple(fields.slice(1));
        if (!parsed) return invalid('domain', line);
        if (keyword === 'DOMAIN_MIN') domainMin = parsed;
        else domainMax = parsed;
      } else {
        return invalid('keyword', keyword);
      }
      continue;
    }
    const row = triple(fields);
    if (!row) {
      const shapeOk = fields.length === 3;
      return invalid(shapeOk ? 'notFinite' : 'rowShape', `line ${index + 1}`);
    }
    rows.push(row[0], row[1], row[2]);
  }
  if (size === null) return invalid('sizeMissing');
  // Grades are fitted and applied over 0–1 R′G′B′ (SPEC P3.7); another domain would shift every colour.
  if (!isUnit(domainMin, domainMax))
    return invalid('domain', `${domainMin.join(' ')} – ${domainMax.join(' ')}`);
  if (rows.length !== size ** 3 * 3) return invalid('rowCount', `${rows.length / 3} of ${size ** 3}`);
  return ok({ size, title, domainMin, domainMax, values: Float32Array.from(rows) });
}

/** Reads and validates a `.cube` file, with the sha256 of its bytes (graded segments are cached by it). */
export async function readCube(
  path: string,
  options: ParseCubeOptions = {},
): AsyncResult<{ readonly lut: CubeLut; readonly sha256: string }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (cause) {
    return err(CubeInvalid({ reason: 'unreadable' }, { detail: String(cause).slice(0, 200) }));
  }
  const parsed = parseCube(bytes.toString('utf8'), options);
  if (!parsed.ok) return parsed;
  return ok({ lut: parsed.value, sha256: createHash('sha256').update(bytes).digest('hex') });
}

/** Six decimals: below one 16-bit code value, and short enough for a 33³ file. */
const format = (value: number) => String(Math.round(value * 1e6) / 1e6);

/** The `.cube` text of a table: LF line ends, keywords first, rows red fastest. */
export function writeCube(lut: CubeLut): string {
  const lines = [
    ...(lut.title ? [`TITLE "${lut.title.replace(/"/gu, "'")}"`] : []),
    `LUT_3D_SIZE ${lut.size}`,
    `DOMAIN_MIN ${lut.domainMin.map(format).join(' ')}`,
    `DOMAIN_MAX ${lut.domainMax.map(format).join(' ')}`,
  ];
  for (let row = 0; row < lut.size ** 3; row++)
    lines.push(
      `${format(lut.values[row * 3] ?? 0)} ${format(lut.values[row * 3 + 1] ?? 0)} ${format(lut.values[row * 3 + 2] ?? 0)}`,
    );
  return `${lines.join('\n')}\n`;
}

/** A table sampled from `map` on the size³ lattice (red fastest). */
export function cubeFromFunction(size: number, map: (rgb: Rgb) => Rgb, title: string | null = null): CubeLut {
  const values = new Float32Array(size ** 3 * 3);
  const step = 1 / (size - 1);
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const out = map([r * step, g * step, b * step]);
        const at = (r + size * g + size * size * b) * 3;
        values[at] = out[0];
        values[at + 1] = out[1];
        values[at + 2] = out[2];
      }
  return { size, title, domainMin: [0, 0, 0], domainMax: [1, 1, 1], values };
}

/** The table that changes nothing. */
export function identityCube(size: number): CubeLut {
  return cubeFromFunction(size, (rgb) => rgb, 'Identity');
}
