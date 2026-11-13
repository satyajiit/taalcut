// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Render's own hardware paths on media's software retry (IX3-K4; the PO's decision at the IX2 gate): the QA video
 * pass, the grade's CPU route, conform's segment encode and still, and finishing. A hardware decoder or encoder
 * that won't start (media's `hardwareRefused`) runs the job once more on its software route, which uses no
 * hardware at all: a refusal under load says the machine's sessions are taken. A path that always retried
 * any FFmpeg failure on the hardware route (a file the hardware can't take) keeps that wider rule. Each retry is
 * one `compute.fallback`, built with core's `computeFallbackEvent` (`accelerator_failed`, FFmpeg's reason as the
 * detail), naming the hardware the first route asked for (VideoToolbox on a Mac, NVDEC/NVENC on NVIDIA). These jobs write files and stream nothing to their caller, so a retry never hands anything out twice.
 */
import {
  computeFallbackEvent,
  type AsyncResult,
  type ComputeBackend,
  type ComputeFallbackEvent,
  type TaalcutError,
} from '@taalcut/core';
import { hardwareRefused, retryOnSoftwareRoute } from '@taalcut/media';

export interface HardwareRoute<R> {
  /** The route the job runs on first. */
  readonly first: R;
  /** The route without hardware; undefined when `first` already is one, or there is none (HEVC encode). */
  readonly software: R | undefined;
  /** `compute.fallback`'s operation, e.g. `render.conformDecode`. */
  readonly operation: string;
  /** The compute backends the first route asks for: the retry's `wanted` (['videotoolbox'], ['cuda', 'nvenc']). */
  readonly wanted: readonly ComputeBackend[];
  /** The hardware's name in a wider-rule retry's detail: 'VideoToolbox', 'NVDEC/NVENC'. */
  readonly label: string;
  /** Retry any FFmpeg failure on the hardware route too, not only a refusal (the path's older, wider rule). */
  readonly anyFfmpegFailure: boolean;
  readonly signal?: AbortSignal;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
}

/** Why the failure sends the job to its software route, or undefined (a cancel never does). */
function reasonToRetry(route: HardwareRoute<unknown>, error: TaalcutError): string | undefined {
  if (route.signal?.aborted) return undefined;
  const refused = hardwareRefused(error);
  if (refused !== undefined) return refused;
  if (!route.anyFfmpegFailure || error.code !== 'media.ffmpeg_failed') return undefined;
  return `${route.label} failed: ${(error.detail ?? '').slice(-300)}`;
}

/** `run` on the route's first route, and once more on its software route when the hardware failed to start. */
export function onHardwareRoute<R, T>(
  route: HardwareRoute<R>,
  run: (on: R) => AsyncResult<T>,
): AsyncResult<T> {
  const software = route.software;
  if (software === undefined) return run(route.first);
  return retryOnSoftwareRoute(
    {
      first: route.first,
      software: () => software,
      why: (error) => reasonToRetry(route, error),
      report: (reason) =>
        route.onFallback?.(
          computeFallbackEvent(route.operation, route.wanted, {
            reason: 'accelerator_failed',
            messageKey: 'compute.fallback.accelerator_failed',
            detail: reason.slice(0, 2000),
          }),
        ),
    },
    run,
  );
}
