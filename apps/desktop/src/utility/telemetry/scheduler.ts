// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When batches leave. The real scheduler's timer is unref'd so a 10-minute
 * wait cannot keep the utility process alive after main has asked it to exit.
 * Tests pass a fake with the same three methods and never wait out the interval.
 */

/** One outstanding callback. `flush` runs it now; `stop` drops it. */
export interface TelemetryScheduler {
  schedule(ms: number, fn: () => void): void;
  flush(): void;
  stop(): void;
}

/** How often a non-empty queue is sent while the endpoint is healthy. */
export const TELEMETRY_INTERVAL_MS = 10 * 60 * 1000;

/** Quit tries to empty the queue, then gives up so the process can exit. */
export const TELEMETRY_QUIT_BUDGET_MS = 2_000;

/** One POST. The quit flush may send several of these inside the budget. */
export const TELEMETRY_BATCH = 200;

/** 1s, 2s, 4s, … capped at 60s. `attempt` is 1 for the first failure. */
export function telemetryBackoffMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(60_000, 1_000 * 2 ** (n - 1));
}

export function createTelemetryScheduler(): TelemetryScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: (() => void) | undefined;
  const clear = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  return {
    schedule(ms, fn) {
      if (timer) clearTimeout(timer);
      pending = fn;
      timer = setTimeout(() => {
        timer = undefined;
        const run = pending;
        pending = undefined;
        run?.();
      }, ms);
      timer.unref();
    },
    flush() {
      const run = pending;
      pending = undefined;
      if (timer) clearTimeout(timer);
      timer = undefined;
      run?.();
    },
    stop: clear,
  };
}
