// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The shapes of a planned mix (mix-plan.ts makes them, mix-graph.ts and mix.ts read them). */
import {
  FrameRate,
  RationalTime,
  type AudioDspPresetId,
  type AudioEffectChain,
  type MusicPath,
} from '@taalcut/core';
import type { TempoPiece } from '../plan/speed-curve';

export const MIX_SAMPLE_RATE = 48_000;
const SAMPLE_RATE = FrameRate.of(MIX_SAMPLE_RATE);

/** A time at 48 kHz, rounded to the nearest sample (exact for 48 kHz files and frame-aligned times). */
export function toSamples(time: RationalTime): number {
  return RationalTime.rescale(time, SAMPLE_RATE, 'round').value;
}

export interface MixSegment {
  /** A clip id, 'music' or 'reference'. */
  readonly id: string;
  readonly kind: 'clip' | 'music' | 'reference';
  readonly path: string;
  /** First sample of the file used, at 48 kHz after resampling. */
  readonly inSample: number;
  /** Where it starts on the render. */
  readonly startSample: number;
  /** How long it sounds on the render. */
  readonly samples: number;
  readonly gainDb: number;
  readonly fadeInSamples: number;
  readonly fadeOutSamples: number;
  /** Source seconds per render second. 1 is real time; a ramp's mean, whose curve is in `pieces`. */
  readonly tempo: number;
  /** A speed ramp's sound: constant-tempo pieces played back to back from `inSample` (speed-curve.ts). */
  readonly pieces?: readonly TempoPiece[];
  /** With pieces: source samples of silence before the file's first sample (an in-point before it). */
  readonly padSamples?: number;
  /** With pieces: render samples dropped before frame 0 (a span that starts before it). */
  readonly skipSamples?: number;
  /** Optional Pedalboard-style studio DSP chain or preset applied to this segment before gain/fades. */
  readonly dspChain?: AudioEffectChain | AudioDspPresetId;
}

export interface AudioMixPlan {
  readonly sampleRate: typeof MIX_SAMPLE_RATE;
  /** Exactly round(N · 48000 · den / num). */
  readonly totalSamples: number;
  readonly segments: readonly MixSegment[];
  /** Path a with no clip sound kept: a silent track of exact length, no loudness pass. */
  readonly silent: boolean;
  readonly music: MusicPath;
  /** True only on path d. */
  readonly referenceAudio: boolean;
}
