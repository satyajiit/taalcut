// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Time-stretching (SPEC P3.4, P3.5): music onto the beat map bar by bar, and a voice line compressed by at most
 * 8 %. One port, two engines behind it: Signalsmith Stretch (MIT, WebAssembly; the default) and FFmpeg's built-in
 * `atempo` (LGPL, WSOLA), the fallback only when every ratio is within 0.90–1.10. Never Rubber Band (GPL).
 * There is no GPU time-stretch, so the stretch is a logged CPU fallback (`no_accelerator`).
 */
import type { AsyncResult } from '@taalcut/core';
import type { Pcm } from '../pcm/pcm';

/** One span of the source mapped to a target length, in samples at the PCM's rate. */
export interface StretchSegment {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  /** Output samples for this span; the ratio is targetLength / (sourceEnd − sourceStart). */
  readonly targetLength: number;
}

export const STRETCH_ENGINES = ['signalsmith', 'atempo'] as const;
export type StretchEngine = (typeof STRETCH_ENGINES)[number];

export interface TimeStretcher {
  readonly engine: StretchEngine;
  /**
   * The output: the segments' spans, each stretched to its target length, back to back, with the engine's
   * latency trimmed so output sample 0 is source sample `segments[0].sourceStart`. Pitch is kept.
   */
  stretch(input: Pcm, segments: readonly StretchSegment[], signal?: AbortSignal): AsyncResult<Pcm>;
}
