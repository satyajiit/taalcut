// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Global shift between two small gray thumbnails by phase correlation: the
 * camera's motion between two samples, from which stability (shake) and the
 * motion class come. A radix-2 FFT on 64×64 costs a few hundred microseconds
 * a frame, so a 10-samples-a-second pass over an hour of footage stays in
 * seconds. TODO(media): the frame-stats graph on ORT WebGPU, built with
 * media's encodeOnnxModel, replaces this once it's built (see frame-stats).
 */

/** Box-filtered downsample of a gray frame (0–255) to size×size. */
export function downsample(gray: Uint8Array, width: number, height: number, size: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let ty = 0; ty < size; ty++) {
    const y0 = Math.floor((ty * height) / size);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / size));
    for (let tx = 0; tx < size; tx++) {
      const x0 = Math.floor((tx * width) / size);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / size));
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += gray[y * width + x] ?? 0;
      out[ty * size + tx] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/** In-place iterative radix-2 FFT of one row or column (n a power of two). */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = start + k;
        const b = a + len / 2;
        const tr = (re[b] as number) * cr - (im[b] as number) * ci;
        const ti = (re[b] as number) * ci + (im[b] as number) * cr;
        re[b] = (re[a] as number) - tr;
        im[b] = (im[a] as number) - ti;
        re[a] = (re[a] as number) + tr;
        im[a] = (im[a] as number) + ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

function fft2d(re: Float64Array, im: Float64Array, size: number, inverse: boolean): void {
  const rowRe = new Float64Array(size);
  const rowIm = new Float64Array(size);
  for (let pass = 0; pass < 2; pass++) {
    for (let line = 0; line < size; line++) {
      for (let i = 0; i < size; i++) {
        const at = pass === 0 ? line * size + i : i * size + line;
        rowRe[i] = re[at] as number;
        rowIm[i] = im[at] as number;
      }
      fft(rowRe, rowIm, inverse);
      for (let i = 0; i < size; i++) {
        const at = pass === 0 ? line * size + i : i * size + line;
        re[at] = rowRe[i] as number;
        im[at] = rowIm[i] as number;
      }
    }
  }
}

const windows = new Map<number, Float64Array>();
function hann(size: number): Float64Array {
  let w = windows.get(size);
  if (!w) {
    w = new Float64Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (size - 1));
        const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (size - 1));
        w[y * size + x] = wx * wy;
      }
    }
    windows.set(size, w);
  }
  return w;
}

function spectrum(image: Float32Array, size: number): [Float64Array, Float64Array] {
  const w = hann(size);
  let mean = 0;
  for (const v of image) mean += v;
  mean /= image.length;
  const re = new Float64Array(size * size);
  for (let i = 0; i < re.length; i++) re[i] = ((image[i] ?? 0) - mean) * (w[i] as number);
  const im = new Float64Array(size * size);
  fft2d(re, im, size, false);
  return [re, im];
}

export interface Shift {
  /** Pixels on the thumbnail grid that `b`'s content moved right relative to `a`. */
  readonly dx: number;
  /** Pixels it moved down. */
  readonly dy: number;
  /** Correlation peak, 0–1: low means no clear global motion (a cut, noise, a flat frame). */
  readonly peak: number;
}

/** Phase correlation of two size×size thumbnails (size a power of two), with a parabolic sub-pixel peak. */
export function phaseShift(a: Float32Array, b: Float32Array, size: number): Shift {
  const [ar, ai] = spectrum(a, size);
  const [br, bi] = spectrum(b, size);
  const re = new Float64Array(size * size);
  const im = new Float64Array(size * size);
  for (let i = 0; i < re.length; i++) {
    // conj(A) · B: the peak sits at b's displacement from a.
    const r = (ar[i] as number) * (br[i] as number) + (ai[i] as number) * (bi[i] as number);
    const m = (ar[i] as number) * (bi[i] as number) - (ai[i] as number) * (br[i] as number);
    const mag = Math.hypot(r, m) || 1;
    re[i] = r / mag;
    im[i] = m / mag;
  }
  fft2d(re, im, size, true);
  let best = 0;
  for (let i = 1; i < re.length; i++) if ((re[i] as number) > (re[best] as number)) best = i;
  const px = best % size;
  const py = Math.floor(best / size);
  const at = (x: number, y: number) =>
    re[(((y % size) + size) % size) * size + (((x % size) + size) % size)] as number;
  const sub = (l: number, c: number, r: number) => {
    const d = l - 2 * c + r;
    return d === 0 ? 0 : (0.5 * (l - r)) / d;
  };
  const fx = px + sub(at(px - 1, py), at(px, py), at(px + 1, py));
  const fy = py + sub(at(px, py - 1), at(px, py), at(px, py + 1));
  const wrap = (v: number) => (v > size / 2 ? v - size : v);
  return { dx: wrap(fx), dy: wrap(fy), peak: Math.max(0, Math.min(1, (re[best] as number) / (size * size))) };
}
