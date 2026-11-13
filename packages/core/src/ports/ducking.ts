// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The ducking planner (P3-V6): gain envelopes that keep music and effects under the voice, and the check that the
 * voice stays above the music in the export. In-process in the render process: render's root registers
 * @taalcut/audio's planner; render writes the stems and applies the envelopes.
 */
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { DuckingSettings } from '../timeline/mix';

export interface DuckingStems {
  /** 48 kHz WAV files render wrote, sample-aligned to the mix; paths inside render's work folder. */
  readonly voice: string;
  readonly music: string | null;
  readonly effects: string | null;
  readonly durationSamples: number;
  readonly signal?: AbortSignal;
}

/** Music or effects gain at a sample, in dB (≤ 0); linear in dB between points. */
export interface GainPoint {
  readonly sample: number;
  readonly db: number;
}

export interface VoiceOverMusicReport {
  /** 100 ms frames over the export, and how many had at least 1.5 s of voice in their 3 s window. */
  readonly frames: number;
  readonly counted: number;
  readonly marginLu: number;
  /** Lowest voice minus music short-term loudness over counted frames; null when none counted. */
  readonly minMarginLu: number | null;
  readonly worst: readonly {
    readonly atMs: number;
    readonly voiceLufs: number;
    readonly musicLufs: number;
  }[];
  readonly passed: boolean;
}

export interface DuckingPlanner {
  /** The envelopes for the music and effects branches (empty when ducking is off or nothing plays under voice). */
  plan(
    stems: DuckingStems,
    settings: DuckingSettings,
  ): AsyncResult<{ readonly music: readonly GainPoint[]; readonly effects: readonly GainPoint[] }>;
  /** Short-term loudness (EBU R128 S, 3 s) of the dry voice and the ducked music, every 100 ms. */
  check(
    stems: { readonly voice: string; readonly duckedMusic: string; readonly signal?: AbortSignal },
    marginLu: number,
  ): AsyncResult<VoiceOverMusicReport>;
}
export const DuckingPlannerToken = createToken<DuckingPlanner>('core.duckingPlanner');
