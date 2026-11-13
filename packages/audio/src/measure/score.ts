// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Speech ratio and music score. Pure: no files, no ffmpeg. */
import type { TimeRange } from '@taalcut/core';
import { AUDIO_CONFIG } from '../config';
import { rangeToMs } from '../rates';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface Span {
  startMs: number;
  endMs: number;
}

/**
 * Share of `durationMs` covered by words at or above the confidence floor.
 * A missing confidence counts (the engine did not say it was unsure).
 * Overlaps are merged. The result is capped at 1.
 */
export function speechRatioOf(
  words: readonly { range: TimeRange; confidence?: number }[],
  durationMs: number,
): number {
  if (!(durationMs > 0)) return 0;
  const floor = AUDIO_CONFIG.speech.confidenceFloor;
  const spans: Span[] = [];
  for (const word of words) {
    if (word.confidence !== undefined && word.confidence < floor) continue;
    const span = rangeToMs(word.range);
    if (span.endMs > span.startMs) spans.push(span);
  }
  spans.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  let covered = 0;
  let open = false;
  let start = 0;
  let end = 0;
  for (const span of spans) {
    if (!open) {
      start = span.startMs;
      end = span.endMs;
      open = true;
      continue;
    }
    if (span.startMs <= end) end = Math.max(end, span.endMs);
    else {
      covered += end - start;
      start = span.startMs;
      end = span.endMs;
    }
  }
  if (open) covered += end - start;
  return Math.min(1, covered / durationMs);
}

/** Population coefficient of variation. Fewer than two intervals → 0 regularity. */
function regularityOf(intervalsMs: readonly number[]): number {
  const n = intervalsMs.length;
  if (n < 2) return 0;
  let sum = 0;
  for (const interval of intervalsMs) sum += interval;
  const mean = sum / n;
  if (mean === 0) return 0;
  let square = 0;
  for (const interval of intervalsMs) {
    const delta = interval - mean;
    square += delta * delta;
  }
  const cv = Math.sqrt(square / n) / mean;
  return clamp(1 - cv / AUDIO_CONFIG.classify.regularityCv, 0, 1);
}

/**
 * Mean activation on non-silent frames (or of every activation, when no frame
 * is non-silent), times beat regularity. Empty input is 0.
 */
export function musicScoreOf(
  activations: readonly number[],
  nonSilentFrame: readonly boolean[],
  beatIntervalsMs: readonly number[],
): number {
  const audible: number[] = [];
  const n = Math.min(activations.length, nonSilentFrame.length);
  for (let i = 0; i < n; i += 1) {
    if (nonSilentFrame[i]) audible.push(activations[i] ?? 0);
  }
  const pool = audible.length > 0 ? audible : activations;
  if (pool.length === 0) return 0;
  let sum = 0;
  for (const value of pool) sum += value;
  return clamp((sum / pool.length) * regularityOf(beatIntervalsMs), 0, 1);
}
