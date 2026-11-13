// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Awaiting a job's outcome. The store is the truth: a waiter re-reads the job
 * whenever this engine emits an event about it, and every `pollMs` for
 * changes made by other processes (another engine finishing it, a cancel
 * over IPC). Progress events from this engine are forwarded as they happen.
 */
import { CancelledError, err, ok, type JobId, type Result } from '@taalcut/core';
import type { WaitOptions } from './api';
import type { ProgressValue } from './progress';
import { TERMINAL_STATES, type JobEvent, type JobRecord } from './types';

interface Waiter {
  changed(): void;
  readonly progress?: (progress: ProgressValue) => void;
}

interface WaitPorts {
  get(): Promise<Result<JobRecord>>;
  cancel(): Promise<Result<JobRecord>>;
  readonly pollMs: number;
}

function jobIdOf(event: JobEvent): JobId | undefined {
  if ('job' in event) return event.job.id;
  if ('jobId' in event) return event.jobId;
  return undefined;
}

export class Waiters {
  private readonly byJob = new Map<JobId, Set<Waiter>>();

  /** Called with every event the engine emits. */
  notify(event: JobEvent): void {
    const id = jobIdOf(event);
    const waiters = id === undefined ? undefined : this.byJob.get(id);
    if (!waiters) return;
    for (const waiter of waiters) {
      if (event.type !== 'job.progress') waiter.changed();
      else
        waiter.progress?.({
          fraction: event.fraction,
          ...(event.detail === undefined ? {} : { detail: event.detail }),
        });
    }
  }

  async wait(id: JobId, options: WaitOptions, ports: WaitPorts): Promise<Result<JobRecord>> {
    const { signal, onProgress, cancelOnAbort = true } = options;
    let changes = 0;
    let wake: (() => void) | undefined;
    const waiter: Waiter = {
      changed: () => {
        changes++;
        wake?.();
      },
      ...(onProgress ? { progress: onProgress } : {}),
    };
    const waiters = this.byJob.get(id) ?? new Set<Waiter>();
    waiters.add(waiter);
    this.byJob.set(id, waiters);
    try {
      for (;;) {
        if (signal?.aborted) return await this.abandon(waiters, cancelOnAbort, ports);
        const seen = changes;
        const current = await ports.get();
        if (!current.ok) return current;
        if (TERMINAL_STATES.includes(current.value.state)) return ok(current.value);
        if (changes !== seen) continue; // Something happened while reading: read again.
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', done);
            wake = undefined;
            resolve();
          };
          const timer = setTimeout(done, ports.pollMs);
          signal?.addEventListener('abort', done, { once: true });
          wake = done;
        });
      }
    } finally {
      waiters.delete(waiter);
      if (waiters.size === 0) this.byJob.delete(id);
    }
  }

  /**
   * Stops waiting. Only the last waiter in this engine cancels the job: a
   * de-duplicated job (same idempotency key) may have other callers still
   * waiting for it.
   */
  private async abandon(waiters: Set<Waiter>, cancelOnAbort: boolean, ports: WaitPorts) {
    if (cancelOnAbort && waiters.size === 1) {
      const current = await ports.get();
      if (current.ok && !TERMINAL_STATES.includes(current.value.state)) await ports.cancel();
    }
    return err(CancelledError(undefined, { detail: 'the caller stopped waiting for the job' }));
  }
}
