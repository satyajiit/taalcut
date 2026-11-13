// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The stretcher the process uses: Signalsmith when its WebAssembly module loads, else `atempo` (which refuses
 * ratios outside 0.90–1.10). No GPU time-stretch exists (research: audio-mixing.md "CPU"), so the first stretch
 * logs one `compute.fallback` with `no_accelerator`, the way `ebur128` is logged.
 */
import {
  computeFallbackEvent,
  cpuFallback,
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { createAtempoStretcher } from './atempo';
import { createSignalsmithStretcher, loadSignalsmithModule } from './signalsmith';
import type { TimeStretcher } from './stretcher';

export const STRETCH_OPERATION = 'audio.timeStretch';

export interface StretcherDeps {
  readonly media: MediaContext;
  readonly scratchDir?: string;
  readonly onComputeFallback?: (event: ComputeFallbackEvent) => void;
  /** Tests: pretend the module is missing. */
  readonly loadModule?: typeof loadSignalsmithModule;
}

export async function createTimeStretcher(deps: StretcherDeps): AsyncResult<TimeStretcher> {
  const loaded = await (deps.loadModule ?? loadSignalsmithModule)();
  const inner = loaded.ok
    ? createSignalsmithStretcher(loaded.value)
    : createAtempoStretcher({
        media: deps.media,
        ...(deps.scratchDir ? { scratchDir: deps.scratchDir } : {}),
      });
  let logged = false;
  return ok({
    engine: inner.engine,
    stretch(input, segments, signal) {
      if (!logged) {
        logged = true;
        const choice = cpuFallback('no_accelerator', `time-stretch on the CPU (${inner.engine})`);
        if (choice.fallback)
          deps.onComputeFallback?.(computeFallbackEvent(STRETCH_OPERATION, ['cpu'], choice.fallback));
      }
      return inner.stretch(input, segments, signal);
    },
  });
}
