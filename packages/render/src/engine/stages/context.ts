// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What every export stage runs with (SPEC section 4): the engine's deps, the render, its folder and signal. */
import type { ComputeFallbackEvent, RenderRecord } from '@taalcut/core';
import type { RenderEngineDeps } from '../deps';
import type { ProgressTracker } from '../progress';

export interface StageContext {
  readonly deps: RenderEngineDeps;
  readonly record: RenderRecord;
  readonly workDir: string;
  readonly signal: AbortSignal;
  readonly tracker: ProgressTracker;
  readonly fallback: (event: ComputeFallbackEvent) => void;
}
