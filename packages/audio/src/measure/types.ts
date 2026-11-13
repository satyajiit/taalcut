// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The plan's audio offset is the only field `measureAudio` reads. */
import type { RationalTime, TimeRange } from '@taalcut/core';
import type { AudioKind } from './labels';

export interface AudioPlan {
  /** Where this audio starts on the asset clock. Absent means the start of the file. */
  readonly audioStart?: RationalTime;
}

export interface LoudnessReading {
  readonly integratedLufs: number;
  readonly loudnessRange: number;
  readonly truePeakDbtp: number;
}

export interface MeasureResult extends LoudnessReading {
  readonly nonSilentRatio: number;
  readonly nonSilentMs: number;
  readonly durationMs: number;
  /** Non-silent stretches, on the asset clock. */
  readonly stretches: readonly TimeRange[];
  /** Up to three non-overlapping 10 s slices, first non-silent stretch first. */
  readonly slices: readonly TimeRange[];
}

export interface AudioEvidence {
  /** Share of duration covered by words with confidence ≥ 0.5. */
  readonly speechRatio: number;
  /** Mean beat activation on non-silent frames, times beat regularity. */
  readonly musicScore: number;
  readonly integratedLufs: number | null;
  readonly nonSilentRatio: number;
}

export interface AudioClassification {
  readonly kind: AudioKind;
  readonly silent: boolean;
  readonly evidence: AudioEvidence;
  /** Music transcripts stay out of captions and search. */
  readonly transcriptDropped?: 'music';
}
