// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Nightly performance from what the runner's benchmarks wrote (perf/inputs.ts):
 * `index-1h` from the stage rows of the library the app's pipeline indexed,
 * preview fps and dropped frames from the preview benchmark, render seconds
 * from the render benchmark, peak memory per process from
 * `app.getAppMetrics()`. Each benchmark already ran three times and wrote its
 * median, so every `measure` reads the same files.
 */
import { readIndexBenchmark, readPeakMemory, readPreview, readRender } from '../perf/inputs';
import { type PerfMeasureInput, type PerfSample, type PerfSystem } from './types';

export interface RunnerPerfOptions {
  /** A copy of the app's library.db after it indexed the benchmark footage. */
  readonly libraryDb: string;
  /** Only stage rows finished at or after this (epoch ms). Default 0: every row. */
  readonly since?: number;
  /** `{ medianFps, p5Fps, droppedFrames }` from the 60 s preview benchmark. */
  readonly preview: string;
  /** `{ seconds }` from the 60 s render benchmark. */
  readonly render: string;
  /** JSON lines, each one `app.getAppMetrics()` sample (an array, or `{ metrics }`). */
  readonly appMetrics: string;
}

export function runnerPerfSystem(options: RunnerPerfOptions): PerfSystem {
  return {
    measure(_input: PerfMeasureInput): Promise<PerfSample> {
      return Promise.resolve().then(() => {
        const index = readIndexBenchmark(options.libraryDb, options.since ?? 0);
        const preview = readPreview(options.preview);
        return {
          indexMinutes: index.indexMinutes,
          previewMedianFps: preview.medianFps,
          previewP5Fps: preview.p5Fps,
          droppedFrames: preview.droppedFrames,
          renderSeconds: readRender(options.render).seconds,
          memoryBytes: readPeakMemory(options.appMetrics),
        };
      });
    },
  };
}
