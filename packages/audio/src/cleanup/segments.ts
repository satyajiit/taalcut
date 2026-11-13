// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Speech segments and voiced islands from VAD probabilities, pure, in milliseconds. Segments follow Silero's
 * hysteresis (enter at the threshold, leave under threshold − 0.15 for at least the minimum silence) with no
 * padding and no minimum speech length, so a short "um" stays a segment of its own. Islands are runs of voiced
 * windows, the unit the filler rules measure.
 */
import { CLEANUP_AUDIO_CONFIG } from './config';

export interface Span {
  readonly startMs: number;
  readonly endMs: number;
}

export function speechSegments(probabilities: ArrayLike<number>, windowMs: number): Span[] {
  const { threshold, negThreshold, minSilenceMs } = CLEANUP_AUDIO_CONFIG.vad;
  const segments: Span[] = [];
  let start: number | null = null;
  let silenceFrom: number | null = null;
  for (let i = 0; i < probabilities.length; i++) {
    const p = probabilities[i] ?? 0;
    if (start === null) {
      if (p >= threshold) start = i;
      continue;
    }
    if (p >= negThreshold) {
      silenceFrom = null;
      continue;
    }
    silenceFrom ??= i;
    if ((i + 1 - silenceFrom) * windowMs >= minSilenceMs) {
      segments.push({ startMs: start * windowMs, endMs: silenceFrom * windowMs });
      start = null;
      silenceFrom = null;
    }
  }
  if (start !== null)
    segments.push({ startMs: start * windowMs, endMs: (silenceFrom ?? probabilities.length) * windowMs });
  return segments;
}

/** Runs of windows at or over the threshold. */
export function voicedIslands(probabilities: ArrayLike<number>, windowMs: number): Span[] {
  const islands: Span[] = [];
  let start: number | null = null;
  for (let i = 0; i <= probabilities.length; i++) {
    const voiced = i < probabilities.length && (probabilities[i] ?? 0) >= CLEANUP_AUDIO_CONFIG.vad.threshold;
    if (voiced && start === null) start = i;
    if (!voiced && start !== null) {
      islands.push({ startMs: start * windowMs, endMs: i * windowMs });
      start = null;
    }
  }
  return islands;
}

/** Every gap between speech segments of at least the pause floor (200 ms). */
export function pausesBetween(segments: readonly Span[]): Span[] {
  const pauses: Span[] = [];
  for (let i = 1; i < segments.length; i++) {
    const startMs = segments[i - 1]?.endMs ?? 0;
    const endMs = segments[i]?.startMs ?? 0;
    if (endMs - startMs >= CLEANUP_AUDIO_CONFIG.minPauseMs) pauses.push({ startMs, endMs });
  }
  return pauses;
}

export const overlapMs = (a: Span, b: Span) =>
  Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
