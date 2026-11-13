// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Per-sample statistics of a gray thumbnail (256 px long side, 10 samples a
 * second): sharpness as the variance of a 3×3 Laplacian (blur), luma mean,
 * spread and clipped fractions (exposure), the black-frame share
 * (blackdetect's rule: ≥ 98 % of pixels at or under 10 % of full scale), and
 * the 64×64 thumbnail the shift and freeze checks use.
 *
 * GPU first (ADR 0002): the SPEC's route is one ONNX graph on ORT WebGPU,
 * built in memory with media's `encodeOnnxModel`. That graph isn't built yet
 * (the encoder writes no node attributes or initializers), so these run in
 * TypeScript on thumbnails that VideoToolbox decoded, and
 * `frameStatsFallback()` is the `compute.fallback` record that says so.
 * TODO(media): build the graph with encodeOnnxModel and keep this as the
 * reference the graph is tested against.
 */
import { computeFallbackEvent, cpuFallback, type ComputeFallbackEvent } from '@taalcut/core';
import { VISION_CONFIG } from '../config';
import { downsample } from './shift';

export interface FrameStats {
  /** Grid frame. */
  readonly index: number;
  /** Variance of the 3×3 Laplacian (0 4-neighbour kernel), gray 0–255. */
  readonly laplacianVariance: number;
  readonly mean: number;
  /** Standard deviation of luma: near 0 is a flat frame. */
  readonly std: number;
  /** Share of pixels ≤ 16 and ≥ 235. */
  readonly dark: number;
  readonly bright: number;
  /** ≥ 98 % of pixels at or under 10 % of full scale (blackdetect's defaults). */
  readonly black: boolean;
  /** 64×64 box-filtered thumbnail, 0–255. */
  readonly thumb: Float32Array;
}

export interface GrayFrame {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

const BLACK_PIXEL = 25.5;
const BLACK_SHARE = 0.98;

export function frameStats(frame: GrayFrame): FrameStats {
  const { width, height, data } = frame;
  let sum = 0;
  let sumSq = 0;
  let dark = 0;
  let bright = 0;
  let black = 0;
  for (const v of data) {
    sum += v;
    sumSq += v * v;
    if (v <= 16) dark++;
    if (v >= 235) bright++;
    if (v <= BLACK_PIXEL) black++;
  }
  const n = Math.max(1, data.length);
  const mean = sum / n;
  let lapSum = 0;
  let lapSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const l =
        (data[i - width] as number) +
        (data[i + width] as number) +
        (data[i - 1] as number) +
        (data[i + 1] as number) -
        4 * (data[i] as number);
      lapSum += l;
      lapSq += l * l;
      count++;
    }
  }
  const lapMean = count > 0 ? lapSum / count : 0;
  return {
    index: frame.index,
    laplacianVariance: count > 0 ? lapSq / count - lapMean * lapMean : 0,
    mean,
    std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
    dark: dark / n,
    bright: bright / n,
    black: black / n >= BLACK_SHARE,
    thumb: downsample(data, width, height, VISION_CONFIG.quality.shiftSize),
  };
}

/** The one `compute.fallback` record for frame statistics in TypeScript (see above). */
export function frameStatsFallback(): ComputeFallbackEvent {
  const choice = cpuFallback(
    'no_accelerator',
    "the WebGPU frame-stats graph isn't built yet; stats run on VideoToolbox-decoded thumbnails",
  );
  if (choice.backend !== 'cpu') throw new Error('unreachable');
  return computeFallbackEvent('vision.frameStats', ['webgpu', 'cpu'], choice.fallback);
}

/** 64-bit dHash (Krawetz): 9×8 gray, a bit per left-right pair, set when the right pixel is brighter. 16 hex digits. */
export function dHash(gray: Uint8Array, width: number, height: number): string {
  const small = new Float32Array(72);
  for (let ty = 0; ty < 8; ty++) {
    const y0 = Math.floor((ty * height) / 8);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / 8));
    for (let tx = 0; tx < 9; tx++) {
      const x0 = Math.floor((tx * width) / 9);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / 9));
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += gray[y * width + x] ?? 0;
      small[ty * 9 + tx] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  let hex = '';
  for (let ty = 0; ty < 8; ty++) {
    let byte = 0;
    for (let tx = 0; tx < 8; tx++) {
      const left = small[ty * 9 + tx] as number;
      const right = small[ty * 9 + tx + 1] as number;
      byte = (byte << 1) | (left < right ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Bits that differ between two 16-hex-digit hashes. */
export function hamming(a: string, b: string): number {
  let bits = 0;
  for (let i = 0; i < 16; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    for (; x; x &= x - 1) bits++;
  }
  return bits;
}
