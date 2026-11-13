// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PP-OCRv5 input tensors, as the shipped inference.yml files define them
 * (spike 05 measured these): the detector resizes the long side to 960 with
 * each side a multiple of 32, then ImageNet mean and std; the recogniser
 * resizes a line crop to height 48 and maps pixels to [-1, 1]. Both take BGR,
 * CHW. Frames arrive as rgb24, so the channel swap happens while filling.
 */

export const DET_LONG_SIDE = 960;
export const DET_MEAN = [0.485, 0.456, 0.406] as const;
export const DET_STD = [0.229, 0.224, 0.225] as const;
export const REC_HEIGHT = 48;
/** The yml's base width (`image_shape [3, 48, 320]`): narrower crops are padded to it. */
export const REC_BASE_WIDTH = 320;
/** A very long line is squeezed rather than given an unbounded tensor. */
export const REC_MAX_WIDTH = 1280;

export interface Rgb {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface Tensor {
  readonly data: Float32Array;
  readonly dims: readonly number[];
}

/** The detector's input size for a frame: long side 960, each side rounded to a multiple of 32 (≥ 32). */
export function detGeometry(width: number, height: number): { width: number; height: number } {
  const ratio = DET_LONG_SIDE / Math.max(width, height);
  const round32 = (n: number) => Math.max(Math.round(Math.trunc(n * ratio) / 32) * 32, 32);
  return { width: round32(width), height: round32(height) };
}

/** Half-pixel bilinear resize of rgb24 (close to OpenCV's INTER_LINEAR, which Paddle uses). */
export function resizeRgb(src: Rgb, width: number, height: number): Rgb {
  if (src.width === width && src.height === height) return src;
  const out = new Uint8Array(width * height * 3);
  const xScale = src.width / width;
  const yScale = src.height / height;
  const at = (x: number, y: number, c: number) => {
    const cx = Math.min(src.width - 1, Math.max(0, x));
    const cy = Math.min(src.height - 1, Math.max(0, y));
    return src.data[(cy * src.width + cx) * 3 + c] ?? 0;
  };
  for (let y = 0; y < height; y++) {
    const fy = (y + 0.5) * yScale - 0.5;
    const y0 = Math.floor(fy);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = (x + 0.5) * xScale - 0.5;
      const x0 = Math.floor(fx);
      const wx = fx - x0;
      const o = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        const v =
          at(x0, y0, c) * (1 - wx) * (1 - wy) +
          at(x0 + 1, y0, c) * wx * (1 - wy) +
          at(x0, y0 + 1, c) * (1 - wx) * wy +
          at(x0 + 1, y0 + 1, c) * wx * wy;
        out[o + c] = Math.min(255, Math.max(0, Math.round(v)));
      }
    }
  }
  return { data: out, width, height };
}

/** A pixel rectangle of the frame, clamped to it; null when nothing is left. */
export function cropRgb(src: Rgb, x0: number, y0: number, x1: number, y1: number): Rgb | null {
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(src.width, Math.ceil(x1));
  const bottom = Math.min(src.height, Math.ceil(y1));
  if (right <= left || bottom <= top) return null;
  const width = right - left;
  const height = bottom - top;
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const from = ((top + y) * src.width + left) * 3;
    out.set(src.data.subarray(from, from + width * 3), y * width * 3);
  }
  return { data: out, width, height };
}

/** The detector tensor `[1, 3, H, W]`, BGR, (x/255 − mean) / std per channel in BGR order (the spike's order). */
export function detTensor(frame: Rgb): Tensor & { readonly width: number; readonly height: number } {
  const size = detGeometry(frame.width, frame.height);
  const resized = resizeRgb(frame, size.width, size.height);
  const plane = size.width * size.height;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      // Channel c of BGR is channel 2 − c of RGB.
      const value = (resized.data[i * 3 + (2 - c)] ?? 0) / 255;
      data[c * plane + i] = (value - (DET_MEAN[c] ?? 0)) / (DET_STD[c] ?? 1);
    }
  }
  return { data, dims: [1, 3, size.height, size.width], width: size.width, height: size.height };
}

/** Width a crop takes in the recogniser: height 48, aspect kept, at least the base width, capped. */
export function recWidth(crop: { width: number; height: number }): { resized: number; padded: number } {
  const ratio = crop.width / Math.max(crop.height, 1);
  const padded = Math.min(
    REC_MAX_WIDTH,
    Math.trunc(REC_HEIGHT * Math.max(REC_BASE_WIDTH / REC_HEIGHT, ratio)),
  );
  const resized = Math.max(1, Math.min(padded, Math.ceil(REC_HEIGHT * ratio)));
  return { resized, padded };
}

/**
 * One recogniser batch `[N, 3, 48, W]`: each crop resized to height 48, BGR,
 * (x/255 − 0.5)/0.5, right-padded with zeros to the widest crop (Paddle's own batching).
 */
export function recTensor(crops: readonly Rgb[]): Tensor {
  const widths = crops.map(recWidth);
  const width = Math.max(REC_BASE_WIDTH, ...widths.map((w) => w.padded));
  const plane = REC_HEIGHT * width;
  const data = new Float32Array(crops.length * 3 * plane);
  crops.forEach((crop, n) => {
    const resizedWidth = Math.min(widths[n]?.resized ?? 1, width);
    const resized = resizeRgb(crop, resizedWidth, REC_HEIGHT);
    const base = n * 3 * plane;
    for (let y = 0; y < REC_HEIGHT; y++) {
      for (let x = 0; x < resizedWidth; x++) {
        const s = (y * resizedWidth + x) * 3;
        const o = y * width + x;
        for (let c = 0; c < 3; c++) {
          data[base + c * plane + o] = ((resized.data[s + (2 - c)] ?? 0) / 255 - 0.5) / 0.5;
        }
      }
    }
  });
  return { data, dims: [crops.length, 3, REC_HEIGHT, width] };
}
