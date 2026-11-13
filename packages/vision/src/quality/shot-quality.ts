// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A shot's quality, motion and energy from its samples (P2-L8). Scores are
 * 0–1, 1 best, through the calibration constants in VISION_CONFIG.quality
 * (starting points, re-fitted on the G25 fixtures and the sample libraries).
 * Black and frozen: blackdetect's and freezedetect's intervals on the same
 * decode (media's analyseVideo, passed in as `detected`), or the same rules
 * on the samples, so a shot under blackdetect's 2 s minimum is still black.
 */
import type { CameraMotion, QualityFlag, QualityScores } from '@taalcut/core';
import { VISION_CONFIG } from '../config';
import type { FrameStats } from './frame-stats';
import { phaseShift } from './shift';

/** One sample's statistics plus its change from the previous sample (absent for a shot's first). */
export interface SampleSignals extends Omit<FrameStats, 'thumb'> {
  /** Global shift from the previous sample, as a fraction of the thumbnail's side. */
  readonly shift?: { readonly x: number; readonly y: number };
  /** Mean absolute difference of the 64×64 thumbnails from the previous sample, 0–255. */
  readonly change?: number;
}

/** A sample's signals; `previous` is the sample before it in the same pass. */
export function sampleSignals(stats: FrameStats, previous: FrameStats | undefined): SampleSignals {
  const { thumb, ...rest } = stats;
  if (!previous) return rest;
  const size = q.shiftSize;
  const shift = phaseShift(previous.thumb, thumb, size);
  const change = meanAbs(previous.thumb, thumb);
  // A flat or black frame, or no clear correlation peak (noise, a cut): no measurable camera move.
  const flat = stats.std < q.flatVariance || previous.std < q.flatVariance;
  if (flat || shift.peak < q.minShiftPeak) return { ...rest, shift: { x: 0, y: 0 }, change };
  return { ...rest, shift: { x: shift.dx / size, y: shift.dy / size }, change };
}

export interface ShotSignals {
  readonly quality: QualityScores;
  readonly motion: CameraMotion;
  readonly energy: number;
  /** Grid frame of the sharpest sample. */
  readonly bestFrame: number;
}

const q = VISION_CONFIG.quality;
const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function meanAbs(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return a.length > 0 ? sum / a.length : 0;
}

/** Freezedetect's rule: at most 0.001 of full scale (−60 dB) of change for 2 s or more. */
function frozen(changes: readonly number[], secondsPerSample: number): boolean {
  let still = 0;
  for (const change of changes) {
    still = change / 255 <= 0.001 ? still + secondsPerSample : 0;
    if (still >= 2) return true;
  }
  return false;
}

export function exposureScore(mean: number, dark: number, bright: number): number {
  const low = mean < q.darkMean ? mean / q.darkMean : 1;
  const high = mean > q.brightMean ? (255 - mean) / (255 - q.brightMean) : 1;
  const clipped = clamp01((Math.max(dark, bright) - 0.05) / (q.clipFraction - 0.05));
  return clamp01(Math.min(low, high) * (1 - 0.5 * clipped));
}

/**
 * Scores one shot from its samples in order. `secondsPerSample` is the
 * sampling interval; the shift between neighbours is the camera's motion.
 */
export function scoreShot(
  samples: readonly SampleSignals[],
  secondsPerSample: number,
  detected: { readonly black?: boolean; readonly frozen?: boolean } = {},
): ShotSignals {
  const sharpRaw = median(samples.map((s) => s.laplacianVariance));
  const sharpness = clamp01(sharpRaw / (sharpRaw + q.sharpnessMid));
  const mean = median(samples.map((s) => s.mean));
  const dark = median(samples.map((s) => s.dark));
  const bright = median(samples.map((s) => s.bright));
  const exposure = exposureScore(mean, dark, bright);

  // The first sample's change is from the previous shot: not this shot's motion.
  const moving = samples.slice(1);
  const shifts = moving.map((s) => s.shift ?? { x: 0, y: 0 });
  const changes = moving.map((s) => s.change ?? 0);
  // Low-pass (a 5-sample moving average) is the intended camera move; what is left is shake.
  const low = shifts.map((_, i) => {
    const window = shifts.slice(Math.max(0, i - 2), i + 3);
    return {
      x: window.reduce((s, v) => s + v.x, 0) / window.length,
      y: window.reduce((s, v) => s + v.y, 0) / window.length,
    };
  });
  const rms =
    shifts.length > 0
      ? Math.sqrt(
          shifts.reduce((s, v, i) => s + (v.x - (low[i]?.x ?? 0)) ** 2 + (v.y - (low[i]?.y ?? 0)) ** 2, 0) /
            shifts.length,
        )
      : 0;
  const stability = clamp01(q.shakeMid ** 2 / (q.shakeMid ** 2 + rms ** 2));
  const vx = low.length > 0 ? low.reduce((s, v) => s + v.x, 0) / low.length / secondsPerSample : 0;
  const vy = low.length > 0 ? low.reduce((s, v) => s + v.y, 0) / low.length / secondsPerSample : 0;
  const speed = Math.hypot(vx, vy);
  let motion: CameraMotion;
  if (speed < q.panSpeed) motion = stability < q.shakyBelow ? 'handheld' : 'static';
  else motion = Math.abs(vx) >= Math.abs(vy) ? 'pan' : 'tilt';
  const energy = clamp01(
    0.5 * Math.min(1, speed / (4 * q.panSpeed)) + 0.5 * Math.min(1, median(changes) / 25),
  );

  const black =
    detected.black === true ||
    (samples.filter((s) => s.black).length * 2 >= samples.length && samples.length > 0);
  const isFrozen = detected.frozen === true || frozen(changes, secondsPerSample);
  const flags: QualityFlag[] = [];
  if (sharpness < q.blurryBelow) flags.push('blurry');
  if (mean < q.darkMean) flags.push('dark');
  if (mean > q.brightMean || bright > q.clipFraction) flags.push('overexposed');
  if (stability < q.shakyBelow) flags.push('shaky');
  if (median(samples.map((s) => s.std)) < q.flatVariance) flags.push('flat');
  if (black) flags.push('black');
  if (isFrozen) flags.push('frozen');
  const weighted =
    q.weights.sharpness * sharpness + q.weights.exposure * exposure + q.weights.stability * stability;
  const overall = clamp01(black ? 0 : isFrozen ? weighted * 0.5 : weighted);

  let best = samples[0];
  for (const sample of samples) if (best && sample.laplacianVariance > best.laplacianVariance) best = sample;
  return {
    quality: { version: VISION_CONFIG.version, sharpness, exposure, stability, overall, flags },
    motion,
    energy,
    bestFrame: best?.index ?? 0,
  };
}
