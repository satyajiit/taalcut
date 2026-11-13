// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reinhard 2001 (eqs. 10–11) in Ruderman lαβ, with a strength.
 * `out = (in − μ_source) · σ_target / σ_source + μ_target`, then blended in R′G′B′.
 */
import type { LookStats } from '@taalcut/core';
import { encodedToRuderman, rudermanToEncoded, type Rgb } from './colour-space';

/** Equal within this is the same look: the map is exactly the node (no round trip). */
const STATS_EPS = 1e-9;
/** A source deviation this small is a flat channel. Scaling it would divide by ~0. */
const MIN_STD = 1e-8;

function axis(value: number, meanS: number, stdS: number, meanT: number, stdT: number): number {
  const gain = stdS > MIN_STD ? stdT / stdS : 1;
  return (value - meanS) * gain + meanT;
}

function sameLook(source: LookStats, target: LookStats): boolean {
  if (source.encoding !== target.encoding) return false;
  return (
    Math.abs(source.mean[0] - target.mean[0]) <= STATS_EPS &&
    Math.abs(source.mean[1] - target.mean[1]) <= STATS_EPS &&
    Math.abs(source.mean[2] - target.mean[2]) <= STATS_EPS &&
    Math.abs(source.std[0] - target.std[0]) <= STATS_EPS &&
    Math.abs(source.std[1] - target.std[1]) <= STATS_EPS &&
    Math.abs(source.std[2] - target.std[2]) <= STATS_EPS
  );
}

/** One full-range R′G′B′ pixel (0–1) through the transfer. No strength, no identity shortcut. */
export function transferPixel(rgb: Rgb, source: LookStats, target: LookStats): Rgb {
  const lab = encodedToRuderman(rgb, source.encoding);
  return rudermanToEncoded(
    [
      axis(lab[0], source.mean[0], source.std[0], target.mean[0], target.std[0]),
      axis(lab[1], source.mean[1], source.std[1], target.mean[1], target.std[1]),
      axis(lab[2], source.mean[2], source.std[2], target.mean[2], target.std[2]),
    ],
    source.encoding,
  );
}

/**
 * Smooth [0, 1] skin-tone membership weight in unit R′G′B′ [0..1] using the YCbCr skin-locus ellipse.
 * Used to dampen aggressive chroma shifts on human skin when baking a 3D LUT.
 */
export function skinToneWeight(rgb: Rgb): number {
  const r = rgb[0] * 255;
  const g = rgb[1] * 255;
  const b = rgb[2] * 255;
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (y < 35 || y > 245 || r <= g || r <= b) return 0;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  // Center of skin ellipse at (Cb = 102, Cr = 153), radii (25, 20).
  const distSq = ((cb - 102) / 25) ** 2 + ((cr - 153) / 20) ** 2;
  if (distSq >= 1) return 0;
  return 1 - distSq;
}

/**
 * Strength blends in encoded R′G′B′: `node + s · (map(node) − node)`.
 * Identity when the looks match within 1e-9, or when strength is 0.
 * When `options.protectSkinTones` is true, skin-locus pixels attenuate transfer strength by up to 65%
 * so human faces never turn green or magenta under stylized reference grades.
 */
export function reinhardMap(
  rgb: Rgb,
  source: LookStats,
  target: LookStats,
  strength: number,
  options?: { readonly protectSkinTones?: boolean },
): Rgb {
  if (strength === 0 || sameLook(source, target)) return [rgb[0], rgb[1], rgb[2]];
  const mapped = transferPixel(rgb, source, target);
  const skinAttenuation = options?.protectSkinTones ? 1 - 0.65 * skinToneWeight(rgb) : 1;
  const eff = strength * skinAttenuation;
  return [
    rgb[0] + eff * (mapped[0] - rgb[0]),
    rgb[1] + eff * (mapped[1] - rgb[1]),
    rgb[2] + eff * (mapped[2] - rgb[2]),
  ];
}
