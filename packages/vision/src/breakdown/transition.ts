// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pixel evidence for a soft cut, on small gray thumbnails of every frame of
 * the span: where a crossfade passes half, whether the inner frames really
 * are blends of the two ends (a dissolve, not motion inside one shot), and
 * which transition it is (fade, whip, dissolve).
 */
import type { SampledFrame } from '../media/frames';
import type { TransitionKind } from './types';

/** A luma minimum this far below both ends is a dip to black: a fade. */
const FADE_DIP = 0.5;
/** Mean luma (0–255) the dip must reach to count as black. */
const FADE_BLACK = 60;
/** A whip: the frame difference peaks this many times the span's median while sharpness halves. */
const WHIP_MAFD_RATIO = 3;
const WHIP_BLUR_RATIO = 0.5;
/** Inner frames fit (1 − α)·first + α·last with a residual under this share of |last − first|. */
const BLEND_RESIDUAL = 0.35;
/** α must climb from near 0 to near 1, through at least this many frames in between (gradual). */
const BLEND_MIN_INNER = 2;

export interface SoftEvidence {
  /** The inner frames are blends of the ends, α rising: a dissolve. */
  readonly blend: boolean;
  readonly transition: TransitionKind;
  /** Where it passes half: the first frame closer to the last frame than to the first. */
  readonly frame: number;
}

export function softEvidence(thumbs: readonly SampledFrame[]): SoftEvidence | undefined {
  const first = thumbs[0];
  const last = thumbs[thumbs.length - 1];
  if (!first || !last || thumbs.length < 3) return undefined;
  return { blend: isBlend(thumbs), transition: classifyTransition(thumbs), frame: crossover(thumbs) };
}

/**
 * The first frame that looks more like the span's last frame than its first:
 * where a crossfade passes half. Frame difference alone drifts toward the
 * side whose content moves more; distances to both ends cancel that out.
 */
export function crossover(thumbs: readonly SampledFrame[]): number {
  const first = thumbs[0]!;
  const last = thumbs[thumbs.length - 1]!;
  for (const thumb of thumbs.slice(1)) {
    if (difference(thumb, last) <= difference(thumb, first)) return thumb.index;
  }
  return last.index;
}

/** Least-squares α and residual of each inner frame against the line from the first to the last frame. */
export function isBlend(thumbs: readonly SampledFrame[]): boolean {
  const a = thumbs[0]!.data;
  const b = thumbs[thumbs.length - 1]!.data;
  const n = Math.min(a.length, b.length);
  let span = 0;
  for (let i = 0; i < n; i++) span += ((b[i] ?? 0) - (a[i] ?? 0)) ** 2;
  if (span === 0) return false;
  const alphas: number[] = [];
  const residuals: number[] = [];
  for (const thumb of thumbs.slice(1, -1)) {
    let dot = 0;
    for (let i = 0; i < n; i++) dot += ((thumb.data[i] ?? 0) - (a[i] ?? 0)) * ((b[i] ?? 0) - (a[i] ?? 0));
    const alpha = dot / span;
    let residual = 0;
    for (let i = 0; i < n; i++) {
      const fit = (a[i] ?? 0) + alpha * ((b[i] ?? 0) - (a[i] ?? 0));
      residual += ((thumb.data[i] ?? 0) - fit) ** 2;
    }
    alphas.push(alpha);
    residuals.push(Math.sqrt(residual / span));
  }
  const sorted = [...residuals].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 1;
  const inner = alphas.filter((alpha) => alpha > 0.1 && alpha < 0.9).length;
  let rising = 0;
  for (let i = 1; i < alphas.length; i++) if ((alphas[i] ?? 0) >= (alphas[i - 1] ?? 0) - 0.05) rising++;
  return median < BLEND_RESIDUAL && inner >= BLEND_MIN_INNER && rising >= 0.8 * (alphas.length - 1);
}

/** fade when luma dips toward black inside the span; whip when difference and blur spike together. */
export function classifyTransition(thumbs: readonly SampledFrame[]): TransitionKind {
  const stats = thumbs.map((t) => ({ luma: meanOf(t), sharp: laplacianVariance(t) }));
  const first = stats[0]!;
  const last = stats[stats.length - 1]!;
  const inner = stats.slice(1, -1);
  const minLuma = Math.min(...inner.map((s) => s.luma));
  if (minLuma < FADE_BLACK && minLuma < FADE_DIP * Math.min(first.luma, last.luma)) return 'fade';
  const diffs = thumbs.slice(1).map((t, i) => difference(t, thumbs[i]!));
  const sorted = [...diffs].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const peak = Math.max(...diffs);
  const minSharp = Math.min(...inner.map((s) => s.sharp));
  const blurred = minSharp < WHIP_BLUR_RATIO * Math.min(first.sharp, last.sharp);
  if (peak > 0 && peak >= WHIP_MAFD_RATIO * Math.max(median, 0.5) && blurred) return 'whip';
  return 'dissolve';
}

export function difference(a: SampledFrame, b: SampledFrame): number {
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0));
  return n === 0 ? 0 : sum / n;
}

function meanOf(frame: SampledFrame): number {
  let sum = 0;
  for (const value of frame.data) sum += value;
  return frame.data.length === 0 ? 0 : sum / frame.data.length;
}

/** Variance of the 3×3 Laplacian of a gray frame: high when sharp, low when blurred. */
export function laplacianVariance(frame: SampledFrame): number {
  const { width, height, data } = frame;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v =
        (data[i - width] ?? 0) +
        (data[i + width] ?? 0) +
        (data[i - 1] ?? 0) +
        (data[i + 1] ?? 0) -
        4 * (data[i] ?? 0);
      sum += v;
      sq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sq / n - mean * mean;
}
