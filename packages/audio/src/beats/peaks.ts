// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Upstream `minimal` peak pick, plus parabolic refinement. Downbeat frames are
 * a subset of the refined beat frames so they index the beat list.
 */
import { AUDIO_CONFIG } from '../config';

const POOL = AUDIO_CONFIG.beats.peakPool;
const PAD = Math.floor(POOL / 2);

/** Local maxima: logit > 0 and equal to the length-7 pooled max (ties kept). */
function peakFrames(logits: Float32Array): number[] {
  const peaks: number[] = [];
  for (let i = 0; i < logits.length; i++) {
    const value = logits[i] ?? 0;
    if (!(value > 0)) continue;
    let max = Number.NEGATIVE_INFINITY;
    const from = Math.max(0, i - PAD);
    const to = Math.min(logits.length - 1, i + PAD);
    for (let j = from; j <= to; j++) {
      const sample = logits[j] ?? Number.NEGATIVE_INFINITY;
      if (sample > max) max = sample;
    }
    if (value === max) peaks.push(i);
  }
  return peaks;
}

/**
 * A run whose consecutive frames are at most `width` apart collapses to the
 * mean frame. Width 1 is upstream's adjacent-peak merge.
 */
export function deduplicatePeaks(peaks: readonly number[], width = 1): number[] {
  if (peaks.length === 0) return [];
  const merged: number[] = [];
  let runStart = 0;
  for (let i = 1; i <= peaks.length; i++) {
    const gap = i < peaks.length ? (peaks[i] ?? 0) - (peaks[i - 1] ?? 0) : Infinity;
    if (gap > width) {
      let sum = 0;
      for (let k = runStart; k < i; k++) sum += peaks[k] ?? 0;
      merged.push(sum / (i - runStart));
      runStart = i;
    }
  }
  return merged;
}

/** Parabola through the integer frame and its neighbours. Missing sides stay put. */
export function parabolicShift(frame: number, logits: Float32Array): number {
  const i = Math.round(frame);
  if (Math.abs(frame - i) > 1e-6) return frame;
  if (i <= 0 || i >= logits.length - 1) return i;
  const y0 = logits[i - 1] ?? 0;
  const y1 = logits[i] ?? 0;
  const y2 = logits[i + 1] ?? 0;
  const denom = y0 - 2 * y1 + y2;
  if (Math.abs(denom) < 1e-8) return i;
  const delta = Math.min(0.5, Math.max(-0.5, (0.5 * (y0 - y2)) / denom));
  return i + delta;
}

function snapToBeats(downbeats: readonly number[], beats: readonly number[]): number[] {
  if (beats.length === 0 || downbeats.length === 0) return [];
  const snapped: number[] = [];
  for (const down of downbeats) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i] ?? 0;
      const dist = Math.abs(beat - down);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    snapped.push(beats[best] ?? 0);
  }
  snapped.sort((a, b) => a - b);
  const unique: number[] = [];
  for (const frame of snapped) {
    const prev = unique[unique.length - 1];
    if (prev === undefined || Math.abs(prev - frame) > 1e-9) unique.push(frame);
  }
  return unique;
}

export function pickPeaks(
  beat: Float32Array,
  downbeat: Float32Array,
): { beats: number[]; downbeats: number[] } {
  const beatFrames = deduplicatePeaks(peakFrames(beat));
  const downFrames = deduplicatePeaks(peakFrames(downbeat));
  const beats = beatFrames.map((frame) => parabolicShift(frame, beat));
  const snapped = snapToBeats(downFrames, beatFrames);
  const downbeats = snapped.map((frame) => {
    const index = beatFrames.findIndex((beatFrame) => Math.abs(beatFrame - frame) <= 1e-9);
    return index >= 0 ? (beats[index] ?? frame) : parabolicShift(frame, downbeat);
  });
  return { beats, downbeats };
}
