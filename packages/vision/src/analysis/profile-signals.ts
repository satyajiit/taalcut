// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What casting needs per shot beyond the ShotAnalysis (core's ShotProfile,
 * timeline SPEC "Requests to other lanes", the casting research note): a
 * motion and a sharpness curve on a 100 ms grid from the shot's start, and
 * the frames where motion peaks, at full rate, so an in-point can put a peak
 * within ±1 frame of a beat. Both come from the analysis pass: its samples
 * (about 10 a second) give the curves, and the change between every decoded
 * frame gives the peaks. Decoding dominates that pass, so reading every frame
 * instead of every third measured the same on a 4K HEVC clip.
 *
 * They travel as the analysis's `signals` (core's ShotSignals), so the
 * library stores them with the rest of the ShotAnalysis and maps them into
 * ShotProfile.
 */
import type { ShotSignals } from '@taalcut/core';
import { VISION_CONFIG } from '../config';
import type { SampleSignals } from '../quality/shot-quality';

const p = VISION_CONFIG.profile;
const q = VISION_CONFIG.quality;

const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const round2 = (x: number) => Math.round(clamp01(x) * 100) / 100;

/** A sample's motion: shot energy's formula (camera speed and picture change) on one sample. */
export function sampleMotion(sample: SampleSignals, secondsPerSample: number): number {
  const shift = sample.shift ?? { x: 0, y: 0 };
  const speed = Math.hypot(shift.x, shift.y) / Math.max(1e-6, secondsPerSample);
  const change = ((sample.change ?? 0) * (p.sampleMs / 1000)) / Math.max(1e-6, secondsPerSample);
  return clamp01(0.5 * Math.min(1, speed / (4 * q.panSpeed)) + 0.5 * Math.min(1, change / p.changeScale));
}

/** A sample's sharpness on the shot score's scale. */
export function sampleSharpness(sample: Pick<SampleSignals, 'laplacianVariance'>): number {
  const raw = Math.max(0, sample.laplacianVariance);
  return clamp01(raw / (raw + q.sharpnessMid));
}

/**
 * Values at grid frames, linearly interpolated onto the 100 ms grid from
 * `start` for `frames` frames at `fps`; held flat past the first and last.
 */
export function resampleCurve(
  points: readonly { readonly index: number; readonly value: number }[],
  start: number,
  frames: number,
  fps: number,
): number[] {
  if (points.length === 0) return [];
  const seconds = Math.max(1, frames) / fps;
  const count = Math.max(1, Math.ceil((seconds * 1000) / p.sampleMs - 1e-9));
  const sorted = [...points].sort((a, b) => a.index - b.index);
  const out: number[] = [];
  let k = 0;
  for (let j = 0; j < count; j++) {
    const at = start + (j * p.sampleMs * fps) / 1000;
    while (k < sorted.length - 1 && (sorted[k + 1] as { index: number }).index <= at) k++;
    const a = sorted[k] as { index: number; value: number };
    const b = sorted[Math.min(sorted.length - 1, k + 1)] as { index: number; value: number };
    const t = b.index > a.index ? Math.min(1, Math.max(0, (at - a.index) / (b.index - a.index))) : 0;
    out.push(round2(a.value + (b.value - a.value) * t));
  }
  return out;
}

/**
 * Peaks of the per-frame change (mean absolute difference of 64×64
 * thumbnails from the frame before, index 0 = the shot's first frame, whose
 * change is the cut and never counts): a local maximum over a 3-frame ring,
 * scaled to change per 100 ms, at or above `peakMin`. The strongest
 * `maxPeaks`, in frame order.
 */
export function motionPeaks(frameChange: readonly number[], fps: number): number[] {
  const scale = (fps * p.sampleMs) / 1000 / p.changeScale;
  const motion = Array.from(frameChange, (change, i) => (i === 0 ? 0 : clamp01((change ?? 0) * scale)));
  const peaks: { frame: number; value: number }[] = [];
  for (let i = 1; i < motion.length - 1; i++) {
    const value = motion[i] as number;
    if (value < p.peakMin) continue;
    if (value > (motion[i - 1] as number) && value >= (motion[i + 1] as number))
      peaks.push({ frame: i, value });
  }
  return peaks
    .sort((a, b) => b.value - a.value || a.frame - b.frame)
    .slice(0, p.maxPeaks)
    .map((peak) => peak.frame)
    .sort((a, b) => a - b);
}

export interface ShotSignalsInput {
  /** The shot's first and end grid frames. */
  readonly start: number;
  readonly end: number;
  readonly fps: number;
  readonly secondsPerSample: number;
  /** The shot's samples in order; the first one's change is from the shot before. */
  readonly samples: readonly SampleSignals[];
  /** Change per frame from the shot's first frame. */
  readonly frameChange: readonly number[];
}

/** The curves and peaks of one shot; curves are left empty for a shot past `maxCurveSamples`. */
export function shotProfileSignals(input: ShotSignalsInput): ShotSignals {
  const { samples, secondsPerSample } = input;
  const frames = Math.max(1, input.end - input.start);
  const motion = samples.map((sample, i) => {
    // The first sample's change and shift are across the cut: take its neighbour's motion.
    const own = i === 0 ? samples[1] : sample;
    return { index: sample.index, value: own ? sampleMotion(own, secondsPerSample) : 0 };
  });
  const sharpness = samples.map((sample) => ({ index: sample.index, value: sampleSharpness(sample) }));
  const tooLong = (frames / input.fps) * (1000 / p.sampleMs) > p.maxCurveSamples;
  return {
    version: p.version,
    motionCurve: tooLong ? [] : resampleCurve(motion, input.start, frames, input.fps),
    sharpnessCurve: tooLong ? [] : resampleCurve(sharpness, input.start, frames, input.fps),
    motionPeakFrames: motionPeaks(input.frameChange.slice(0, frames), input.fps),
  };
}
