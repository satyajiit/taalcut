// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Gray images for the camera-motion estimator (FRM1-MOT): a float copy of a decoded frame, its pyramid (each level
 * half the last, box-filtered), central-difference gradients, bilinear sampling, and Shi-Tomasi corners spread over
 * a grid so the fit sees the whole frame, not its busiest corner. Pure and allocation-light: a 384 px frame's
 * pyramid and corners take a few milliseconds.
 */

export interface GrayImage {
  readonly width: number;
  readonly height: number;
  /** Row-major, 0–255. */
  readonly data: Float32Array;
}

export interface Level extends GrayImage {
  /** d/dx and d/dy, central differences (zero on the border). */
  readonly gx: Float32Array;
  readonly gy: Float32Array;
}

export function grayImage(data: Uint8Array, width: number, height: number): GrayImage {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = data[i] ?? 0;
  return { width, height, data: out };
}

function half(image: GrayImage): GrayImage {
  const width = Math.max(1, image.width >> 1);
  const height = Math.max(1, image.height >> 1);
  const out = new Float32Array(width * height);
  const src = image.data;
  const w = image.width;
  for (let y = 0; y < height; y++) {
    const row = 2 * y * w;
    for (let x = 0; x < width; x++) {
      const at = row + 2 * x;
      out[y * width + x] =
        ((src[at] as number) +
          (src[at + 1] as number) +
          (src[at + w] as number) +
          (src[at + w + 1] as number)) /
        4;
    }
  }
  return { width, height, data: out };
}

function withGradients(image: GrayImage): Level {
  const { width, height, data } = image;
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      gx[i] = ((data[i + 1] as number) - (data[i - 1] as number)) / 2;
      gy[i] = ((data[i + width] as number) - (data[i - width] as number)) / 2;
    }
  }
  return { width, height, data, gx, gy };
}

/** Level 0 is the image itself; each next level is half the size. Stops before a side falls under 24 px. */
export function pyramid(image: GrayImage, levels: number): Level[] {
  const out: Level[] = [withGradients(image)];
  let current = image;
  while (out.length < levels && Math.min(current.width, current.height) >= 48) {
    current = half(current);
    out.push(withGradients(current));
  }
  return out;
}

/** Bilinear sample with clamping at the edges. */
export function sample(values: Float32Array, width: number, height: number, x: number, y: number): number {
  const cx = x < 0 ? 0 : x > width - 1.001 ? width - 1.001 : x;
  const cy = y < 0 ? 0 : y > height - 1.001 ? height - 1.001 : y;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const i = y0 * width + x0;
  const a = values[i] as number;
  const b = values[i + 1] as number;
  const c = values[i + width] as number;
  const d = values[i + width + 1] as number;
  return a + fx * (b - a) + fy * (c - a) + fx * fy * (a - b - c + d);
}

export interface Corner {
  readonly x: number;
  readonly y: number;
  /** Shi-Tomasi response: the structure tensor's smaller eigenvalue. */
  readonly score: number;
}

/**
 * The strongest corner in each cell of a `columns` × `rows` grid (Shi-Tomasi on a 5×5 window), kept when its
 * response is at least `relative` of the frame's strongest and over `floor` (a flat sky or wall gives none).
 * `skip(x, y)` leaves out points in masked areas (a subject, a caption). Corners keep `border` pixels from the edge.
 */
export function gridCorners(
  level: Level,
  options: {
    readonly columns: number;
    readonly rows: number;
    readonly relative: number;
    readonly floor: number;
    readonly border: number;
    readonly skip?: (x: number, y: number) => boolean;
  },
): Corner[] {
  const { width, height, gx, gy } = level;
  const { columns, rows, border } = options;
  // The structure tensor's three products, summed over a 5×5 window by two running box sums.
  const n = width * height;
  const products = [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as const;
  for (let i = 0; i < n; i++) {
    const ix = gx[i] as number;
    const iy = gy[i] as number;
    products[0][i] = ix * ix;
    products[1][i] = ix * iy;
    products[2][i] = iy * iy;
  }
  const [sxx, sxy, syy] = products.map((values) => boxSum(values, width, height, 2));
  const best: (Corner | undefined)[] = Array.from({ length: columns * rows });
  let strongest = 0;
  for (let y = border; y < height - border; y++) {
    const row = Math.min(rows - 1, Math.floor((y * rows) / height));
    for (let x = border; x < width - border; x++) {
      if (options.skip?.(x, y)) continue;
      const i = y * width + x;
      const xx = sxx![i] as number;
      const xy = sxy![i] as number;
      const yy = syy![i] as number;
      const score = (xx + yy - Math.sqrt((xx - yy) * (xx - yy) + 4 * xy * xy)) / 2;
      const cell = row * columns + Math.min(columns - 1, Math.floor((x * columns) / width));
      const held = best[cell];
      if (!held || score > held.score) best[cell] = { x, y, score };
      if (score > strongest) strongest = score;
    }
  }
  const line = Math.max(options.floor, strongest * options.relative);
  return best.filter((corner): corner is Corner => corner !== undefined && corner.score >= line);
}

/** Sum over a (2r+1)² window at each pixel (edges clamped), by a horizontal then a vertical running sum. */
function boxSum(values: Float32Array, width: number, height: number, r: number): Float32Array {
  const across = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let d = -r; d <= r; d++) sum += values[row + Math.min(width - 1, Math.max(0, x + d))] as number;
      across[row + x] = sum;
    }
  }
  const out = new Float32Array(values.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let d = -r; d <= r; d++)
        sum += across[Math.min(height - 1, Math.max(0, y + d)) * width + x] as number;
      out[y * width + x] = sum;
    }
  return out;
}
