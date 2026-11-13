// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A spectrogram runner that an analysis's signal can stop (EAR1-R1). The f64 oracle computes a whole block in one
 * synchronous call (a 5-minute audit's glide spectrogram is seconds of CPU), so an abort could not land until it
 * finished. This runs a block in slices of rows, yielding between them (abort.ts `checkpoint`). Every row is its own
 * transform on both paths, and a slice is a whole number of the graph's 512-row chunks, so the output is the same,
 * bit for bit, as one call's.
 */
import { checkpoint } from '../abort';
import type { SpectrogramRunner } from './spectrogram-graph';

/** Rows per slice: a multiple of the graph's chunk (512) and of the four-step graph's segments per run. */
const SLICE_ROWS = 4096;

export function abortableRunner(runner: SpectrogramRunner, signal?: AbortSignal): SpectrogramRunner {
  if (!signal) return runner;
  return {
    backend: () => runner.backend(),
    release: () => runner.release(),
    async spectrogram(spec, block) {
      await checkpoint(signal);
      const length = spec.frameLength;
      if (block.count <= SLICE_ROWS) return runner.spectrogram(spec, block);
      let data: Float32Array | undefined;
      let columns = 0;
      let backend = 'cpu';
      for (let start = 0; start < block.count; start += SLICE_ROWS) {
        if (start > 0) await checkpoint(signal);
        const count = Math.min(SLICE_ROWS, block.count - start);
        const part = await runner.spectrogram(spec, {
          frames: block.frames.subarray(start * length, (start + count) * length),
          count,
        });
        columns = part.columns;
        backend = part.backend;
        data ??= new Float32Array(block.count * columns);
        data.set(part.data.subarray(0, count * columns), start * columns);
      }
      return { data: data ?? new Float32Array(0), frames: block.count, columns, backend };
    },
    async segmentPower(segments, count, n) {
      await checkpoint(signal);
      // The four-step graph runs 2^20 / n segments at a time; four of its runs per slice.
      const per = Math.max(1, 4 * Math.floor(2 ** 20 / n));
      if (count <= per) return runner.segmentPower(segments, count, n);
      const half = n / 2 + 1;
      const power = new Float64Array(count * half);
      let backend = 'cpu';
      for (let start = 0; start < count; start += per) {
        if (start > 0) await checkpoint(signal);
        const rows = Math.min(per, count - start);
        const part = await runner.segmentPower(segments.subarray(start * n, (start + rows) * n), rows, n);
        backend = part.backend;
        power.set(part.power.subarray(0, rows * half), start * half);
      }
      return { power, backend };
    },
  };
}
