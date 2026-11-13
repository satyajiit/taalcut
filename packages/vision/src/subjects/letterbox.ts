// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A frame into a detector's input tensor: scaled by one factor (aspect kept) into the top-left corner of the
 * tensor, the rest filled with the model's pad value, planar BGR floats 0–255 (RTMO and YOLOX both read OpenCV's
 * BGR), less an optional mean. Shrinking averages k × k bilinear samples per output pixel (k the shrink factor, rounded up),
 * so a 4K frame's small faces aren't lost to aliasing. Pure.
 */

/** An upright RGB24 frame, row-major, three bytes per pixel. */
export interface RgbFrame {
  readonly rgb: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface Letterboxed {
  /** [1, 3, height, width], planes B, G, R. */
  readonly data: Float32Array;
  readonly dims: readonly [1, 3, number, number];
  /** Tensor pixels per frame pixel. */
  readonly scale: number;
}

export interface LetterboxOptions {
  /** The tensor's size. */
  readonly width: number;
  readonly height: number;
  /** The scale; default the largest that fits the frame in the tensor. */
  readonly scale?: number;
  /** The fill outside the image (YOLOX and RTMO 114). */
  readonly pad: number;
  /** Subtracted from every B, G and R value, the fill's too. */
  readonly mean?: readonly [number, number, number];
}

/** The scale that fits the frame inside width × height. */
export const fitScale = (frame: { width: number; height: number }, width: number, height: number): number =>
  Math.min(width / frame.width, height / frame.height);

interface Taps {
  readonly lo: Int32Array;
  readonly hi: Int32Array;
  readonly weight: Float32Array;
}

/** For each output index and sub-sample, the two source indices and the weight of the second. */
function taps(out: number, size: number, scale: number, k: number): Taps {
  const lo = new Int32Array(out * k);
  const hi = new Int32Array(out * k);
  const weight = new Float32Array(out * k);
  for (let i = 0; i < out; i += 1) {
    for (let s = 0; s < k; s += 1) {
      const at = Math.min(size - 1, Math.max(0, (i + (s + 0.5) / k) / scale - 0.5));
      const base = Math.floor(at);
      lo[i * k + s] = base;
      hi[i * k + s] = Math.min(size - 1, base + 1);
      weight[i * k + s] = at - base;
    }
  }
  return { lo, hi, weight };
}

export function letterbox(frame: RgbFrame, options: LetterboxOptions): Letterboxed {
  const { width, height, pad } = options;
  const scale = options.scale ?? fitScale(frame, width, height);
  const plane = width * height;
  const data = new Float32Array(3 * plane).fill(pad);
  const outW = Math.min(width, Math.max(1, Math.round(frame.width * scale)));
  const outH = Math.min(height, Math.max(1, Math.round(frame.height * scale)));
  const k = Math.max(1, Math.ceil(1 / scale - 1e-6));
  const xs = taps(outW, frame.width, scale, k);
  const ys = taps(outH, frame.height, scale, k);
  const rgb = frame.rgb;
  const stride = frame.width * 3;
  const norm = 1 / (k * k);
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < k; sy += 1) {
        const ty = y * k + sy;
        const row0 = ys.lo[ty]! * stride;
        const row1 = ys.hi[ty]! * stride;
        const wy = ys.weight[ty]!;
        for (let sx = 0; sx < k; sx += 1) {
          const tx = x * k + sx;
          const c0 = xs.lo[tx]! * 3;
          const c1 = xs.hi[tx]! * 3;
          const wx = xs.weight[tx]!;
          const w00 = (1 - wx) * (1 - wy);
          const w01 = wx * (1 - wy);
          const w10 = (1 - wx) * wy;
          const w11 = wx * wy;
          r += w00 * rgb[row0 + c0]! + w01 * rgb[row0 + c1]! + w10 * rgb[row1 + c0]! + w11 * rgb[row1 + c1]!;
          g +=
            w00 * rgb[row0 + c0 + 1]! +
            w01 * rgb[row0 + c1 + 1]! +
            w10 * rgb[row1 + c0 + 1]! +
            w11 * rgb[row1 + c1 + 1]!;
          b +=
            w00 * rgb[row0 + c0 + 2]! +
            w01 * rgb[row0 + c1 + 2]! +
            w10 * rgb[row1 + c0 + 2]! +
            w11 * rgb[row1 + c1 + 2]!;
        }
      }
      const at = y * width + x;
      data[at] = b * norm;
      data[plane + at] = g * norm;
      data[2 * plane + at] = r * norm;
    }
  }
  if (options.mean) {
    const mean = options.mean;
    for (let i = 0; i < data.length; i += 1) data[i] = data[i]! - mean[Math.floor(i / plane)]!;
  }
  return { data, dims: [1, 3, height, width], scale };
}
