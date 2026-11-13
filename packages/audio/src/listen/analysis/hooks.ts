// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The analysis's realness and critique hooks (EAR1-F7's extension points, types only): what a plug-in gets and
 * gives. Kept apart from extensions.ts, which imports the lanes' plug-ins, so a plug-in imports these types without
 * a cycle back to it (EAR1-A2).
 */
import type {
  AsyncResult,
  FrameRate,
  RationalTime,
  SoundCritique,
  SoundRealness,
  TaalcutError,
} from '@taalcut/core';
import type { ListenModels, ListenSource } from '../describe/context';
import type { ListenAudio } from '../dsp/pcm';
import type { SpectrogramRunner } from '../dsp/spectrogram-graph';
import type { ListenModelName } from '../models/files';
import type { ListenCritiqueRequest, SoundAnalysis } from './schema';

/** What a pass over one decoded sound gets: both decodes, the spectrogram runner, and the models when they run. */
export interface ListenPassInput {
  /** 48 kHz, stereo or mono duplicated: the DSP's input. */
  readonly audio: ListenAudio;
  /** 48 kHz mono at ffmpeg `-ac 1`'s level: the models' input. */
  readonly source: ListenSource;
  readonly spectrograms: SpectrogramRunner;
  /** Null when no model can run (not installed, no runtime) and the request allowed that. */
  readonly models: ListenModels | null;
  readonly signal?: AbortSignal;
}

/** Lane A1: real recording or code-synthesised; null when it can't tell (no model, silence it reports itself). */
export type RealnessScorer = (input: ListenPassInput) => AsyncResult<SoundRealness | null>;

export interface CritiqueInput extends ListenPassInput {
  /** The analysis so far (measures, events, cut sync, audit, realness), critique still null. */
  readonly analysis: SoundAnalysis;
  readonly cuts: readonly RationalTime[];
  readonly beats: readonly RationalTime[];
  readonly frameRate?: FrameRate;
  readonly request: ListenCritiqueRequest;
  /**
   * EAR1-A2: whether a model the analysis didn't plan may run without a download nobody asked for (an AST that
   * isn't installed leaves the critique's music share unmeasured). Absent: it may.
   */
  readonly mayLoad?: (name: ListenModelName) => Promise<boolean>;
  /**
   * EAR1-R1: the request's `optionalModels`: a model that fails while running (a GPU or runtime error) leaves its
   * part unmeasured, a partial critique, instead of failing it.
   */
  readonly optionalModels?: boolean;
  /** EAR1-R1: told of a model part it tried and left out, so the analysis isn't cached (the next one tries again). */
  readonly skipped?: (part: ListenModelName, error: TaalcutError) => void;
}

/** Lane A1/A2: the scorecard; null when the sound can't be critiqued (too short, near silence). */
export type SoundCritic = (input: CritiqueInput) => AsyncResult<SoundCritique | null>;
