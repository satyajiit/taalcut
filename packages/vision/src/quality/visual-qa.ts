// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * OpenCV-style visual QA checks:
 * 1. `measureHorizonTilt`: Estimates camera roll / horizon tilt in degrees [-15, 15] from strong near-horizontal
 *    Sobel gradients.
 * 2. `measureSkinToneShare`: Computes the fraction of frame pixels inside the ITU-R BT.601 YCbCr human skin-tone
 *    locus.
 * 3. `detectPseFlashRisk`: Flags frequent opposing luminance transitions; this heuristic is not a
 *    BT.1702 or Harding compliance assessment.
 * 4. `evaluateFrameVisualQa`: Combines sharpness, clipping, horizon tilt, skin-tone share, and PSE flash risk.
 */
import type { FrameVisualQaReport } from '@taalcut/core';
import { frameStats } from './frame-stats';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Extracts an 8-bit grayscale buffer from either `rgb24` or `gray` input. */
export function toGrayscaleBuffer(data: Uint8Array, width: number, height: number): Uint8Array {
  const pixels = width * height;
  if (data.length < pixels * 3) return data.subarray(0, pixels);
  const gray = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const p = i * 3;
    gray[i] = Math.round(0.2126 * (data[p] ?? 0) + 0.7152 * (data[p + 1] ?? 0) + 0.0722 * (data[p + 2] ?? 0));
  }
  return gray;
}

/**
 * Estimates dominant near-horizontal line roll/tilt in degrees `[-15, 15]` using the integrated Sobel
 * gradient structure tensor (`atan2(Σ(-gx · sign(gy)), Σ|gy|)`) over strong near-horizontal edges.
 * Integrating across the whole edge recovers the exact continuous slope even on discrete stair-stepped pixels.
 */
export function measureHorizonTilt(
  grayOrRgb: Uint8Array,
  width: number,
  height: number,
): { readonly horizonTiltDegrees: number; readonly horizonConfidence: number } {
  if (width < 8 || height < 8) return { horizonTiltDegrees: 0, horizonConfidence: 0 };
  const gray = toGrayscaleBuffer(grayOrRgb, width, height);
  let sumNegGxSignGy = 0;
  let sumAbsGy = 0;
  let allEdgeMag = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const tl = gray[idx - width - 1] ?? 0;
      const tc = gray[idx - width] ?? 0;
      const tr = gray[idx - width + 1] ?? 0;
      const ml = gray[idx - 1] ?? 0;
      const mr = gray[idx + 1] ?? 0;
      const bl = gray[idx + width - 1] ?? 0;
      const bc = gray[idx + width] ?? 0;
      const br = gray[idx + width + 1] ?? 0;
      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const mag = Math.hypot(gx, gy);
      if (mag < 48) continue;
      allEdgeMag += mag;
      // Keep near-horizontal edges (where vertical gradient |gy| dominates |gx|)
      if (Math.abs(gy) <= Math.abs(gx)) continue;
      const signGy = gy >= 0 ? 1 : -1;
      sumNegGxSignGy += -gx * signGy;
      sumAbsGy += Math.abs(gy);
    }
  }

  if (sumAbsGy <= 0 || allEdgeMag <= 0) return { horizonTiltDegrees: 0, horizonConfidence: 0 };
  const rawDeg = (Math.atan2(sumNegGxSignGy, sumAbsGy) * 180) / Math.PI;
  const horizonTiltDegrees = r3(Math.max(-15, Math.min(15, rawDeg)));
  const horizonConfidence = r3(Math.min(1, sumAbsGy / allEdgeMag));
  return { horizonTiltDegrees, horizonConfidence };
}

/**
 * Returns `[0, 1]` membership of an 8-bit RGB pixel in the human skin-tone chrominance locus (YCbCr ellipse).
 */
export function isSkinToneRgb(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (y < 40 || y > 242) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && r > g && r > b;
}

/** Measures the fraction of pixels `[0, 1]` falling in the human skin-tone locus. */
export function measureSkinToneShare(rgb: Uint8Array, width: number, height: number): number {
  const pixels = width * height;
  if (pixels <= 0 || rgb.length < pixels * 3) return 0;
  let skin = 0;
  for (let i = 0; i < pixels; i++) {
    const p = i * 3;
    if (isSkinToneRgb(rgb[p] ?? 0, rgb[p + 1] ?? 0, rgb[p + 2] ?? 0)) skin++;
  }
  return r3(skin / pixels);
}

/**
 * Luminance-transition warning heuristic; it does not assess red flashes or affected screen area.
 * Flags sequences with > 3 opposing luminance jumps (`|ΔY| >= 20` on 0–255 scale with darker state < 160)
 * within any 1-second sliding window (`2 * flashes >= 6` opposing transitions = 3 full flashes).
 */
export function detectPseFlashRisk(
  lumaMeans: readonly number[],
  fps: number,
): { readonly pseFlashRisk: boolean; readonly maxFlashesPerSecond: number } {
  if (lumaMeans.length < 3 || fps <= 0) return { pseFlashRisk: false, maxFlashesPerSecond: 0 };
  const transitions: { readonly frame: number; readonly sign: 1 | -1 }[] = [];
  for (let i = 1; i < lumaMeans.length; i++) {
    const prev = lumaMeans[i - 1] ?? 0;
    const curr = lumaMeans[i] ?? 0;
    const diff = curr - prev;
    if (Math.abs(diff) >= 20 && Math.min(prev, curr) < 160) {
      const sign: 1 | -1 = diff > 0 ? 1 : -1;
      const last = transitions[transitions.length - 1];
      if (!last || last.sign !== sign) {
        transitions.push({ frame: i, sign });
      }
    }
  }
  const windowFrames = Math.max(2, Math.ceil(fps));
  let maxOpposing = 0;
  for (let i = 0; i < transitions.length; i++) {
    const startFrame = transitions[i]!.frame;
    let count = 1;
    for (let j = i + 1; j < transitions.length; j++) {
      if (transitions[j]!.frame - startFrame <= windowFrames) count++;
      else break;
    }
    if (count > maxOpposing) maxOpposing = count;
  }
  const maxFlashesPerSecond = r3(Math.floor(maxOpposing / 2));
  return {
    pseFlashRisk: maxFlashesPerSecond > 3,
    maxFlashesPerSecond,
  };
}

/** Evaluates all OpenCV-style visual QA metrics on an `rgb24` frame (plus optional sequence luma history). */
export function evaluateFrameVisualQa(
  rgb: Uint8Array,
  width: number,
  height: number,
  sequence?: { readonly lumaMeans: readonly number[]; readonly fps: number },
): FrameVisualQaReport {
  const gray = toGrayscaleBuffer(rgb, width, height);
  const stats = frameStats({ index: 0, width, height, data: gray });
  const { horizonTiltDegrees, horizonConfidence } = measureHorizonTilt(gray, width, height);
  const skinToneShare = measureSkinToneShare(rgb, width, height);
  const hasSequence = sequence && sequence.fps > 0 && sequence.lumaMeans.length > Math.ceil(sequence.fps);
  const pse = hasSequence
    ? detectPseFlashRisk(sequence.lumaMeans, sequence.fps)
    : { pseFlashRisk: null, maxFlashesPerSecond: null };
  return {
    laplacianSharpness: r3(stats.laplacianVariance),
    lumaMean: r3(stats.mean),
    darkClippedShare: r3(stats.dark),
    brightClippedShare: r3(stats.bright),
    horizonTiltDegrees,
    horizonConfidence,
    skinToneShare,
    pseFlashRisk: pse.pseFlashRisk,
    maxFlashesPerSecond: pse.maxFlashesPerSecond,
  };
}
