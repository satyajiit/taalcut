// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Even output size, matching the filter graph: never upscale, yuv420-friendly. */
import { fitWithin } from '../frames/frame-args';
import { uprightSource, type GraphCrop } from './crop';
import type { GraphSize } from './graph';
import type { NormalisationPlan } from './types';

export function even(n: number): number {
  const v = Math.max(2, Math.floor(n));
  return v - (v % 2);
}

export function uprightPixels(
  plan: NormalisationPlan,
  maxLongSide?: number,
): { readonly width: number; readonly height: number } {
  const { width: srcW, height: srcH } = uprightSource(plan);
  if (maxLongSide === undefined || Math.max(srcW, srcH) <= maxLongSide) {
    return { width: even(srcW), height: even(srcH) };
  }
  const fit = fitWithin(srcW, srcH, maxLongSide);
  return { width: even(fit.width), height: even(fit.height) };
}

/** The pixels `normalisationGraph` will actually write for `size` (of the crop, when there is one). */
export function outputSize(
  plan: NormalisationPlan,
  size?: GraphSize,
  crop?: GraphCrop,
): { readonly width: number; readonly height: number } {
  const { width: srcW, height: srcH } = uprightSource(plan, crop);
  if (!size) return { width: even(srcW), height: even(srcH) };
  if (size.width !== undefined && size.height !== undefined) {
    if (size.exact) return { width: even(size.width), height: even(size.height) };
    return { width: even(Math.min(size.width, srcW)), height: even(Math.min(size.height, srcH)) };
  }
  if (size.longSide === undefined || Math.max(srcW, srcH) <= size.longSide) {
    return { width: even(srcW), height: even(srcH) };
  }
  const fit = fitWithin(srcW, srcH, size.longSide);
  return { width: even(fit.width), height: even(fit.height) };
}
