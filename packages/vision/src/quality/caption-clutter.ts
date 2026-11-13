// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * OpenCV-style Sobel edge clutter, WCAG luminance contrast, and face/OCR obstruction analysis for smart
 * caption placement (`analyseCaptionZones`). Helps the Editor, Reviewer, and QA gate decide whether a
 * caption is legible as bare text or needs a translucent backdrop pill or vertical anchor shift.
 */
import {
  overlapArea,
  type CaptionAnchorZone,
  type CaptionPlacementAdvice,
  type CaptionZoneStats,
} from '@taalcut/core';

export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AnalyseCaptionZonesOptions {
  /** Candidate text fill RGB (0–255), default white [255, 255, 255]. */
  readonly textRgb?: readonly [number, number, number];
  /** Normalized [0, 1] boxes to avoid covering (tracked faces, subjects, or baked-in reference subtitles). */
  readonly obstructions?: readonly NormalizedRect[];
  /** Preferred zone when scores are close (default 'bottom'). */
  readonly preferredZone?: CaptionAnchorZone;
}

const ZONE_BANDS: ReadonlyArray<{
  readonly zone: CaptionAnchorZone;
  readonly anchorY: number;
  readonly box: NormalizedRect;
}> = [
  { zone: 'top', anchorY: 0.18, box: { x: 0.1, y: 0.11, width: 0.8, height: 0.14 } },
  { zone: 'middle', anchorY: 0.5, box: { x: 0.1, y: 0.43, width: 0.8, height: 0.14 } },
  { zone: 'bottom', anchorY: 0.78, box: { x: 0.1, y: 0.71, width: 0.8, height: 0.14 } },
];

function srgbToLinear(channel255: number): number {
  const c = Math.max(0, Math.min(255, channel255)) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance in [0, 1] from 8-bit RGB. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio in [1, 21] between two relative luminances in [0, 1]. */
export function wcagContrast(lumA: number, lumB: number): number {
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return Math.min(21, Math.max(1, (lighter + 0.05) / (darker + 0.05)));
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Evaluates caption readability across `top`, `middle`, and `bottom` safe bands on an `rgb24` frame
 * (or 1-channel grayscale buffer when `rgb.length === width * height`).
 */
export function analyseCaptionZones(
  rgb: Uint8Array,
  width: number,
  height: number,
  options: AnalyseCaptionZonesOptions = {},
): CaptionPlacementAdvice {
  const isRgb = rgb.length >= width * height * 3;
  const luma = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (isRgb) {
      const p = i * 3;
      luma[i] = 0.2126 * (rgb[p] ?? 0) + 0.7152 * (rgb[p + 1] ?? 0) + 0.0722 * (rgb[p + 2] ?? 0);
    } else {
      luma[i] = rgb[i] ?? 0;
    }
  }

  // Compute 3x3 Sobel gradient magnitude normalized to [0, 1] (max theoretical 8-bit Sobel |Gx|+|Gy| ≈ 1440).
  const sobel = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const tl = luma[idx - width - 1] ?? 0;
      const tc = luma[idx - width] ?? 0;
      const tr = luma[idx - width + 1] ?? 0;
      const ml = luma[idx - 1] ?? 0;
      const mr = luma[idx + 1] ?? 0;
      const bl = luma[idx + width - 1] ?? 0;
      const bc = luma[idx + width] ?? 0;
      const br = luma[idx + width + 1] ?? 0;
      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      sobel[idx] = Math.min(1, (Math.abs(gx) + Math.abs(gy)) / 640);
    }
  }

  const textColor = options.textRgb ?? [255, 255, 255];
  const textLum = relativeLuminance(textColor[0], textColor[1], textColor[2]);
  const obstructions = options.obstructions ?? [];
  const preferred = options.preferredZone ?? 'bottom';

  const zones: CaptionZoneStats[] = ZONE_BANDS.map(({ zone, anchorY, box }) => {
    const x0 = Math.max(0, Math.floor(box.x * width));
    const x1 = Math.min(width, Math.ceil((box.x + box.width) * width));
    const y0 = Math.max(0, Math.floor(box.y * height));
    const y1 = Math.min(height, Math.ceil((box.y + box.height) * height));
    let sumY = 0;
    let sumSqY = 0;
    let sumEdge = 0;
    let count = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = y * width + x;
        const v = luma[idx] ?? 0;
        sumY += v;
        sumSqY += v * v;
        sumEdge += sobel[idx] ?? 0;
        count++;
      }
    }
    const n = Math.max(1, count);
    const lumaMean = sumY / n;
    const lumaStd = Math.sqrt(Math.max(0, sumSqY / n - lumaMean * lumaMean));
    const edgeClutter = Math.min(1, sumEdge / n);

    // Worst-case local luminance against the text (brightest patch for light text, darkest for dark text).
    const worstPatchLuma255 =
      textLum >= 0.5 ? Math.min(255, lumaMean + 0.75 * lumaStd) : Math.max(0, lumaMean - 0.75 * lumaStd);
    const bgLum = srgbToLinear(worstPatchLuma255);
    const contrastRatio = wcagContrast(textLum, bgLum);

    const bandArea = Math.max(1e-6, box.width * box.height);
    let overlapSum = 0;
    for (const obs of obstructions) {
      overlapSum += overlapArea(box, obs);
    }
    const obstructionOverlap = Math.min(1, overlapSum / bandArea);
    const needsBackdropPill = edgeClutter > 0.24 || contrastRatio < 4.5 || lumaStd > 42;

    const contrastNorm = Math.min(1, (contrastRatio - 1) / 8);
    const prefBonus = zone === preferred ? 0.04 : 0;
    const rawScore =
      (1 - obstructionOverlap) * 0.52 + (1 - edgeClutter) * 0.26 + contrastNorm * 0.22 + prefBonus;
    const score = Math.max(0, Math.min(1, rawScore));

    return {
      zone,
      anchorY,
      edgeClutter: r3(edgeClutter),
      lumaMean: r3(lumaMean),
      lumaStd: r3(lumaStd),
      contrastRatio: r3(contrastRatio),
      obstructionOverlap: r3(obstructionOverlap),
      needsBackdropPill,
      score: r3(score),
    };
  });

  const best = [...zones].sort((a, b) => b.score - a.score)[0] ?? zones[2]!;
  const recommendedBackdropOpacity = best.needsBackdropPill
    ? r3(Math.min(0.82, Math.max(0.55, 0.5 + best.edgeClutter * 0.5)))
    : 0;

  return {
    recommendedZone: best.zone,
    recommendedAnchorY: best.anchorY,
    needsBackdropPill: best.needsBackdropPill,
    recommendedBackdropOpacity,
    zones,
  };
}
