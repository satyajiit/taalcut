// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What every run of one engine shares: the store, its owner id, lease and retry timing, events. */
import { randomUUID } from 'node:crypto';
import type { JobEngineOptions } from './api';
import { DEFAULT_BACKOFF } from './policy';
import type { RunContext } from './run';
import type { JobEvent } from './types';

export interface RunContextHooks {
  /** After the sink: the engine's waiters re-read the job. */
  readonly notify: (event: JobEvent) => void;
  /** Schedules `fn` on the engine's timers (nothing once it stops). */
  readonly later: (ms: number, fn: () => void) => void;
  /** Looks for due jobs again. */
  readonly pump: () => void;
}

export function createRunContext(options: JobEngineOptions, hooks: RunContextHooks): RunContext {
  const leaseMs = options.leaseMs ?? 30_000;
  const sink = options.events;
  const clock = options.clock ?? Date.now;
  return {
    store: options.store,
    owner: options.bootId ?? `jobs:${process.pid}:${randomUUID()}`,
    leaseMs,
    heartbeatMs: options.heartbeatMs ?? Math.max(10, Math.floor(leaseMs / 3)),
    progressIntervalMs: options.progressIntervalMs ?? 250,
    backoff: { ...DEFAULT_BACKOFF, ...options.backoff },
    clock,
    random: options.random ?? Math.random,
    emit: (event) => {
      try {
        sink?.emit(event);
      } catch {
        // A broken listener must not stop the queue.
      }
      hooks.notify(event);
    },
    wakeAt: (time) => hooks.later(Math.max(0, time - clock()) + 5, hooks.pump),
  };
}
