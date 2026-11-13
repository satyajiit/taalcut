// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Mean SSIM (Wang, Bovik, Sheikh, Simoncelli 2004) on 8-bit gray.
 * 11×11 Gaussian window, σ = 1.5, K1 = 0.01, K2 = 0.03, L = 255.
 * The mean is raw and may be negative. Identical images score 1.
 *
 * Above 128×64 each side is reduced by an integer stride (nearest sample, not a
 * float filter) so the score does not depend on a platform convolution.
 */

const WIN = 11;
const SIGMA = 1.5;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;
const MAX_W = 128;
const MAX_H = 64;

export interface GrayImage {
  readonly gray: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** Wang's window. A constant, not a cache of rendered glyphs. */
function gaussianKernel(): Float64Array {
  const kernel = new Float64Array(WIN);
  const centre = (WIN - 1) / 2;
  let sum = 0;
  for (let i = 0; i < WIN; i++) {
    const x = i - centre;
    const weight = Math.exp(-(x * x) / (2 * SIGMA * SIGMA));
    kernel[i] = weight;
    sum += weight;
  }
  for (let i = 0; i < WIN; i++) kernel[i] = (kernel[i] ?? 0) / sum;
  return kernel;
}

const KERNEL = gaussianKernel();

function ssimAt(muX: number, muY: number, varX: number, varY: number, cov: number): number {
  const sigX = varX < 0 ? 0 : varX;
  const sigY = varY < 0 ? 0 : varY;
  const num = (2 * muX * muY + C1) * (2 * cov + C2);
  const den = (muX * muX + muY * muY + C1) * (sigX + sigY + C2);
  return num / den;
}

/** One window over the whole image when the 11×11 kernel does not fit. Uniform weights. */
function globalSsim(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1;
  let sx = 0;
  let sy = 0;
  let sx2 = 0;
  let sy2 = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    sx += x;
    sy += y;
    sx2 += x * x;
    sy2 += y * y;
    sxy += x * y;
  }
  const muX = sx / n;
  const muY = sy / n;
  return ssimAt(muX, muY, sx2 / n - muX * muX, sy2 / n - muY * muY, sxy / n - muX * muY);
}

/** Valid (no padding) separable convolution. Output is (w-10) by (h-10). */
function filterValid(src: Float64Array, width: number, height: number): Float64Array {
  const outW = width - WIN + 1;
  const outH = height - WIN + 1;
  const horiz = new Float64Array(outW * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < outW; x++) {
      let acc = 0;
      const row = y * width + x;
      for (let i = 0; i < WIN; i++) acc += (KERNEL[i] ?? 0) * (src[row + i] ?? 0);
      horiz[y * outW + x] = acc;
    }
  }
  const vert = new Float64Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let acc = 0;
      for (let i = 0; i < WIN; i++) acc += (KERNEL[i] ?? 0) * (horiz[(y + i) * outW + x] ?? 0);
      vert[y * outW + x] = acc;
    }
  }
  return vert;
}

function toFloat(gray: Uint8Array, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = gray[i] ?? 0;
  return out;
}

function strideOf(gray: Uint8Array, width: number, height: number, factor: number): GrayImage {
  if (factor === 1) return { gray, width, height };
  const outW = Math.floor(width / factor);
  const outH = Math.floor(height / factor);
  if (outW < 1 || outH < 1) throw new RangeError('meanSsim: downsample collapsed the image');
  const next = new Uint8Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    const sy = y * factor;
    for (let x = 0; x < outW; x++) next[y * outW + x] = gray[sy * width + x * factor] ?? 0;
  }
  return { gray: next, width: outW, height: outH };
}

function meanOfMaps(
  muX: Float64Array,
  muY: Float64Array,
  ex2: Float64Array,
  ey2: Float64Array,
  exy: Float64Array,
): number {
  const n = muX.length;
  if (n === 0) return 1;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = muX[i] ?? 0;
    const y = muY[i] ?? 0;
    sum += ssimAt(x, y, (ex2[i] ?? 0) - x * x, (ey2[i] ?? 0) - y * y, (exy[i] ?? 0) - x * y);
  }
  return sum / n;
}

/** Mean SSIM. Both images must already be the same size (see `alignCrop`). */
export function meanSsim(left: GrayImage, right: GrayImage): number {
  if (left.width !== right.width || left.height !== right.height) {
    throw new RangeError(`meanSsim: size ${left.width}x${left.height} vs ${right.width}x${right.height}`);
  }
  if (left.width < 1 || left.height < 1) throw new RangeError('meanSsim: empty image');
  const factor = Math.max(1, Math.ceil(left.width / MAX_W), Math.ceil(left.height / MAX_H));
  const a = strideOf(left.gray, left.width, left.height, factor);
  const b = strideOf(right.gray, right.width, right.height, factor);
  const n = a.width * a.height;
  const fa = toFloat(a.gray, n);
  const fb = toFloat(b.gray, n);
  if (a.width < WIN || a.height < WIN) return globalSsim(fa, fb);
  const sqA = new Float64Array(n);
  const sqB = new Float64Array(n);
  const prod = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = fa[i] ?? 0;
    const y = fb[i] ?? 0;
    sqA[i] = x * x;
    sqB[i] = y * y;
    prod[i] = x * y;
  }
  return meanOfMaps(
    filterValid(fa, a.width, a.height),
    filterValid(fb, a.width, a.height),
    filterValid(sqA, a.width, a.height),
    filterValid(sqB, a.width, a.height),
    filterValid(prod, a.width, a.height),
  );
}
