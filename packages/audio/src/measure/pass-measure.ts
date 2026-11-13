// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The index's measure from the audio pass (IX-A1): what `measureAudio` reports, read from the one decode instead
 * of two more. Everything is on the asset clock, as the PCM is: the duration is the PCM's, and silence before a
 * late audio start counts as silence.
 */
import type { AudioPassResult } from '../asset-audio/audio-pass';
import type { Span } from '../cleanup/segments';
import { rangeToMs } from '../rates';
import { finiteLoudness, stretchesOf } from './measure';

export interface PassMeasure {
  readonly integratedLufs: number;
  readonly loudnessRange: number;
  readonly truePeakDbtp: number;
  readonly nonSilentRatio: number;
  readonly nonSilentMs: number;
  readonly durationMs: number;
  /** Non-silent stretches, in order. */
  readonly stretches: readonly Span[];
}

export function measureOfPass(pass: AudioPassResult): PassMeasure {
  const durationMs = pass.pcm.durationMs;
  const stretches = stretchesOf(durationMs, pass.silences, 0).map(rangeToMs);
  const nonSilentMs = stretches.reduce((sum, span) => sum + (span.endMs - span.startMs), 0);
  return {
    integratedLufs: finiteLoudness(pass.loudness.integratedLufs),
    loudnessRange: finiteLoudness(pass.loudness.loudnessRange),
    truePeakDbtp: finiteLoudness(pass.loudness.truePeakDbtp),
    nonSilentRatio: durationMs === 0 ? 0 : nonSilentMs / durationMs,
    nonSilentMs,
    durationMs,
    stretches,
  };
}
