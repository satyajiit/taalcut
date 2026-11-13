// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the EAR1 lanes plug into the analysis without editing it (EAR1-F7): realness and the critique (lane A1's
 * listen/realness and listen/critique, wired by A2) and extra `audio.listen.query` operations (lane B's find).
 * `LISTEN_EXTENSIONS` is what the jobs process uses by default; a lane sets its entry here, in one additive edit,
 * and every caller (the jobs, the in-process listener, the desktop root) picks it up. Immutable configuration, not
 * state: tests pass their own through the deps instead.
 */
import type { AsyncResult } from '@taalcut/core';
import type { z } from 'zod';
import type { ListenModels, ListenSources } from '../describe/context';
import type { ListenDtype } from '../config';
import { createSoundCritic } from '../critique/critic';
import { abQuery } from '../describe/ab-query';
import type { SpectrogramRunner } from '../dsp/spectrogram-graph';
import { createRealnessScorer } from '../realness/scorer';
import { LISTEN_SEARCH_QUERIES } from '../search/queries';
import type { RealnessScorer, SoundCritic } from './hooks';

// EAR1-A2: the realness and critique hooks' types live in hooks.ts (types only), so the lanes' plug-ins below
// import them without importing this file back.
export type { CritiqueInput, ListenPassInput, RealnessScorer, SoundCritic } from './hooks';

/** What an `audio.listen.query` operation gets: the models (always: a query is model work) and the sources. */
export interface ListenQueryContext {
  readonly models: ListenModels;
  readonly sources: ListenSources;
  /** EAR1-B1: the process's spectrogram runner, made on first use (find's onsets). */
  readonly spectrograms?: () => Promise<SpectrogramRunner>;
  /** EAR1-B2: the dtype of the CLAP audio build in use (which shipped embeddings compare with its own). */
  readonly audioDtype?: ListenDtype;
  readonly signal?: AbortSignal;
}

/**
 * One `audio.listen.query` operation: its name, its parameters' schema (checked in the jobs process), and the
 * work. The result is plain JSON data; `runListenQuery` hands it back typed as R.
 */
export interface ListenQueryOp<P = unknown, R = unknown> {
  readonly op: string;
  readonly params: z.ZodType<P>;
  /** Fewest and most sources it takes (default 1 and 20). */
  readonly sources?: { readonly min?: number; readonly max?: number };
  run(context: ListenQueryContext, params: P): AsyncResult<R>;
}

export const defineListenQuery = <P, R>(op: ListenQueryOp<P, R>): ListenQueryOp<P, R> => op;

export interface ListenExtensions {
  readonly realness?: RealnessScorer;
  readonly critique?: SoundCritic;
  /** Operations beyond the built-in describe, match, rank and compare. */
  readonly queries: readonly ListenQueryOp[];
}

/** The lanes' plug-ins: each lane adds its own entry here (A1/A2 `realness` and `critique`, B1 `queries`). */
export const LISTEN_EXTENSIONS: ListenExtensions = {
  // EAR1-A2: lane A1's realness (CLAP) and critique (the launch films, or the template reel).
  realness: createRealnessScorer(),
  critique: createSoundCritic(),
  // EAR1-A3: `ab` (audio.compare's A/B with the measured differences).
  queries: [...LISTEN_SEARCH_QUERIES, abQuery as ListenQueryOp],
};
