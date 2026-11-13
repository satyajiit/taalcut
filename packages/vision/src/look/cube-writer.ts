// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Adobe Cube LUT 1.0 text, from the spec wording only (the PDF is CC BY-NC-SA and is not vendored).
 * Red changes fastest: index r + N·g + N²·b. LF line ends, six decimals, outputs clamped to 0–1.
 */
import { err, ok, ValidationError, type Result } from '@taalcut/core';
import type { Rgb } from './colour-space';

export interface CubeLut {
  readonly title: string;
  readonly size: number;
  readonly domainMin: Rgb;
  readonly domainMax: Rgb;
  /** Packed RGB, length size³·3, red fastest. */
  readonly values: Float64Array;
}

export interface WriteCubeOptions {
  readonly title?: string;
  readonly size?: number;
  /** Lattice node in the 0–1 domain → mapped R′G′B′. */
  readonly sample: (rgb: Rgb) => Rgb;
}

function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  if (value > 1) return 1;
  return value;
}

function fmt(value: number): string {
  return clamp01(value).toFixed(6);
}

/** UTF-8 (basic Latin) cube. Size 17 unless the caller asks; size 2 is for the row-order test. */
export function writeCube(options: WriteCubeOptions): string {
  const size = options.size ?? 17;
  if (!Number.isInteger(size) || size < 2)
    throw new RangeError(`cube size must be an integer ≥ 2, got ${size}`);
  const title = (options.title ?? 'taalcut-reinhard').replace(/["\r\n]/g, '') || 'taalcut-reinhard';
  const lines = [
    `TITLE "${title}"`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
    `LUT_3D_SIZE ${size}`,
  ];
  const denom = size - 1;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const mapped = options.sample([r / denom, g / denom, b / denom]);
        lines.push(`${fmt(mapped[0])} ${fmt(mapped[1])} ${fmt(mapped[2])}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

function triple(line: string): Rgb | undefined {
  const parts = line.split(/\s+/);
  if (parts.length !== 3) return undefined;
  const nums = parts.map(Number);
  const r = nums[0];
  const g = nums[1];
  const b = nums[2];
  if (r === undefined || g === undefined || b === undefined) return undefined;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return undefined;
  return [r, g, b];
}

function bad(detail: string): Result<CubeLut> {
  return err(ValidationError({ field: 'cube' }, { detail }));
}

/** Reads a cube this writer produced. CR is rejected: the format is LF only. */
export function parseCube(text: string): Result<CubeLut> {
  if (text.includes('\r')) return bad('CR in a cube');
  let title = '';
  let size = 0;
  let domainMin: Rgb = [0, 0, 0];
  let domainMax: Rgb = [1, 1, 1];
  let sawMin = false;
  let sawMax = false;
  const data: number[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('TITLE')) {
      const match = /^TITLE\s+"([^"]*)"\s*$/.exec(line);
      const parsed = match?.[1];
      if (parsed === undefined || parsed.length === 0) return bad('TITLE');
      title = parsed;
      continue;
    }
    if (line.startsWith('DOMAIN_MIN')) {
      const parsed = triple(line.slice('DOMAIN_MIN'.length).trim());
      if (!parsed) return bad('DOMAIN_MIN');
      domainMin = parsed;
      sawMin = true;
      continue;
    }
    if (line.startsWith('DOMAIN_MAX')) {
      const parsed = triple(line.slice('DOMAIN_MAX'.length).trim());
      if (!parsed) return bad('DOMAIN_MAX');
      domainMax = parsed;
      sawMax = true;
      continue;
    }
    if (line.startsWith('LUT_3D_SIZE')) {
      const match = /^LUT_3D_SIZE\s+(\d+)\s*$/.exec(line);
      const parsed = match?.[1];
      if (parsed === undefined) return bad('LUT_3D_SIZE');
      size = Number(parsed);
      continue;
    }
    if (line.startsWith('LUT_') || line.startsWith('DOMAIN_')) return bad(line.split(/\s+/)[0] ?? 'keyword');
    const row = triple(line);
    if (!row) return bad('row');
    data.push(row[0], row[1], row[2]);
  }
  if (title.length === 0 || !sawMin || !sawMax) return bad('header');
  if (!Number.isInteger(size) || size < 2) return bad('size');
  if (data.length !== size * size * size * 3) return bad('row count');
  return ok({ title, size, domainMin, domainMax, values: Float64Array.from(data) });
}

function norm(value: number, min: number, max: number): number {
  const span = max - min;
  if (span === 0) return 0;
  const unit = (value - min) / span;
  if (!(unit > 0)) return 0;
  if (unit > 1) return 1;
  return unit;
}

function at(lut: CubeLut, r: number, g: number, b: number): Rgb {
  const index = (r + lut.size * g + lut.size * lut.size * b) * 3;
  return [lut.values[index] ?? 0, lut.values[index + 1] ?? 0, lut.values[index + 2] ?? 0];
}

function scaled(from: Rgb, to: Rgb, t: number): Rgb {
  return [(to[0] - from[0]) * t, (to[1] - from[1]) * t, (to[2] - from[2]) * t];
}

function sum4(a: Rgb, b: Rgb, c: Rgb, d: Rgb): Rgb {
  return [a[0] + b[0] + c[0] + d[0], a[1] + b[1] + c[1] + d[1], a[2] + b[2] + c[2] + d[2]];
}

/** Tetrahedral sample. An identity lattice comes back as the node, including off-lattice points. */
export function sampleCube(lut: CubeLut, rgb: Rgb): Rgb {
  const scale = lut.size - 1;
  const x = norm(rgb[0], lut.domainMin[0], lut.domainMax[0]) * scale;
  const y = norm(rgb[1], lut.domainMin[1], lut.domainMax[1]) * scale;
  const z = norm(rgb[2], lut.domainMin[2], lut.domainMax[2]) * scale;
  const x0 = Math.min(scale, Math.floor(x));
  const y0 = Math.min(scale, Math.floor(y));
  const z0 = Math.min(scale, Math.floor(z));
  const x1 = Math.min(scale, x0 + 1);
  const y1 = Math.min(scale, y0 + 1);
  const z1 = Math.min(scale, z0 + 1);
  const fx = x1 === x0 ? 0 : x - x0;
  const fy = y1 === y0 ? 0 : y - y0;
  const fz = z1 === z0 ? 0 : z - z0;
  const c000 = at(lut, x0, y0, z0);
  const c100 = at(lut, x1, y0, z0);
  const c010 = at(lut, x0, y1, z0);
  const c110 = at(lut, x1, y1, z0);
  const c001 = at(lut, x0, y0, z1);
  const c101 = at(lut, x1, y0, z1);
  const c011 = at(lut, x0, y1, z1);
  const c111 = at(lut, x1, y1, z1);
  if (fx > fy) {
    if (fy > fz) return sum4(c000, scaled(c000, c100, fx), scaled(c100, c110, fy), scaled(c110, c111, fz));
    if (fx > fz) return sum4(c000, scaled(c000, c100, fx), scaled(c100, c101, fz), scaled(c101, c111, fy));
    return sum4(c000, scaled(c000, c001, fz), scaled(c001, c101, fx), scaled(c101, c111, fy));
  }
  if (fz > fy) return sum4(c000, scaled(c000, c001, fz), scaled(c001, c011, fy), scaled(c011, c111, fx));
  if (fz > fx) return sum4(c000, scaled(c000, c010, fy), scaled(c010, c011, fz), scaled(c011, c111, fx));
  return sum4(c000, scaled(c000, c010, fy), scaled(c010, c110, fx), scaled(c110, c111, fz));
}
