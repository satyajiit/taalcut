// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Per-sample `scdet` scores and MAFD, through media's `analyseVideo` on the
 * source's grid (VideoToolbox decode and scale, upright, tone-mapped).
 * FFmpeg has no GPU scdet that takes VideoToolbox frames (`scdet_vulkan`
 * needs Vulkan frames), so the filter runs on the CPU on frames the GPU
 * decoded and downscaled; `sceneFallback` is the one `compute.fallback`
 * record for it.
 */
import {
  CancelledError,
  cpuFallback,
  computeFallbackEvent,
  err,
  ok,
  RationalTime,
  type AsyncResult,
  type ComputeFallbackEvent,
} from '@taalcut/core';
import { analyseVideo, type MediaContext } from '@taalcut/media';
import type { VideoSource } from './frames';

export interface SceneSample {
  /** Grid frame. */
  readonly index: number;
  /** scdet score 0–100 against the previous sample. 0 for the first. */
  readonly score: number;
  /** Mean absolute frame difference against the previous sample (0–255 scale). */
  readonly mafd: number;
}

export interface SceneOptions {
  /** Every n-th grid frame (1: the full grid). */
  readonly every: number;
  /** Only grid frames in [start, end). */
  readonly window?: { readonly start: number; readonly end: number };
  readonly longSide: number;
  readonly signal?: AbortSignal;
}

const TIMEOUT_MS = 30 * 60_000;

/** The CPU record for scene filters (ADR 0002: no accelerated scdet takes these frames). */
export function sceneFallback(): ComputeFallbackEvent {
  const choice = cpuFallback(
    'no_accelerator',
    'scdet runs on frames VideoToolbox decoded and scaled; FFmpeg has no GPU scdet for them',
  );
  if (choice.backend !== 'cpu') throw new Error('unreachable');
  return computeFallbackEvent('vision.sceneScores', ['videotoolbox', 'vulkan', 'cpu'], choice.fallback);
}

export async function sceneScores(
  ctx: MediaContext,
  source: VideoSource,
  options: SceneOptions,
): AsyncResult<SceneSample[]> {
  if (options.signal?.aborted) return err(CancelledError());
  const every = Math.max(1, Math.round(options.every));
  const rate = source.plan.frameRate.output;
  const window = options.window;
  // Indexes stay multiples of `every` inside a window, as a pass over the whole file reads them.
  const start = window ? Math.ceil(Math.max(0, window.start) / every) * every : 0;
  if (window && start >= window.end) return ok([]);
  const range =
    window && source.plan.kind === 'video'
      ? { start: RationalTime.of(start, rate), duration: RationalTime.of(window.end - start, rate) }
      : undefined;
  const analysed = await analyseVideo(source.path, source.plan, ctx, {
    every,
    size: options.longSide,
    timeoutMs: TIMEOUT_MS,
    ...(range ? { range } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!analysed.ok) return analysed;
  const perSecond = rate.num / rate.den;
  const samples: SceneSample[] = [];
  for (const scene of analysed.value.scenes) {
    const index = start + Math.round(scene.timeSec * perSecond) * every;
    if (window && index >= window.end) continue;
    if (samples.length > 0 && index <= (samples[samples.length - 1] as SceneSample).index) continue;
    samples.push({ index, score: scene.score, mafd: scene.mafd ?? 0 });
  }
  return ok(samples);
}
