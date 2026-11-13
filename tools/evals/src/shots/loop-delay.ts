// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How long the detector's thread went without a turn (IX2-S1): Node's event-loop delay histogram
 * (`perf_hooks.monitorEventLoopDelay`) over one clip's `vision.shots`, in milliseconds. In the jobs process that
 * thread also reads FFmpeg's pipes, sends every job's progress and heartbeats and answers cancellation, so a
 * delay here is that long a wait for all of them.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { LoopDelay } from './schema';

/** Sampling interval: a turn later than this is seen. */
const RESOLUTION_MS = 10;

export function watchLoop(): { stop(): LoopDelay } {
  const histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  histogram.enable();
  const ms = (ns: number) => Math.round(ns / 1e4) / 100;
  return {
    stop() {
      histogram.disable();
      return {
        p50: ms(histogram.percentile(50)),
        p99: ms(histogram.percentile(99)),
        max: ms(histogram.max),
        mean: ms(histogram.mean),
      };
    },
  };
}

/** Over clips: the range of their medians and 99th percentiles, and the longest wait. */
export function loopSummary(delays: readonly LoopDelay[]): string | undefined {
  if (delays.length === 0) return undefined;
  const range = (values: number[]) => `${Math.min(...values).toFixed(1)}–${Math.max(...values).toFixed(1)}`;
  return (
    `p50 ${range(delays.map((d) => d.p50))}, p99 ${range(delays.map((d) => d.p99))}, ` +
    `max ${Math.max(...delays.map((d) => d.max)).toFixed(1)}`
  );
}
