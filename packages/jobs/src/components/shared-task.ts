// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One piece of work shared by every caller that asks for it while it runs
 * (two "install Parakeet" clicks download it once). Each caller gets the
 * progress events and the result; cancelling one caller only detaches it. The
 * work itself is aborted when the last caller leaves, or by cancel().
 */
import { CancelledError, err, toTaalcutError, type AsyncResult, type Result } from '@taalcut/core';

export interface JoinOptions<P> {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: P) => void;
}

interface Subscriber<T, P> {
  readonly onProgress?: (progress: P) => void;
  readonly resolve: (result: Result<T>) => void;
}

export class SharedTask<T, P> {
  private readonly controller = new AbortController();
  private readonly subscribers = new Set<Subscriber<T, P>>();
  private latest: P | undefined;
  private outcome: Result<T> | undefined;
  /** Settles with the work's own result, whoever is still listening. Never rejects. */
  readonly result: AsyncResult<T>;

  constructor(work: (signal: AbortSignal, emit: (progress: P) => void) => AsyncResult<T>) {
    const emit = (progress: P) => {
      this.latest = progress;
      for (const subscriber of this.subscribers) subscriber.onProgress?.(progress);
    };
    this.result = Promise.resolve()
      .then(() => work(this.controller.signal, emit))
      .catch((cause: unknown) => err(toTaalcutError(cause)));
    void this.result.then((result) => {
      this.outcome = result;
      for (const subscriber of this.subscribers) subscriber.resolve(result);
      this.subscribers.clear();
    });
  }

  /** Waits for the shared result. A late joiner first gets the latest progress event. */
  join(options: JoinOptions<P> = {}): AsyncResult<T> {
    const { signal, onProgress } = options;
    if (signal?.aborted) return Promise.resolve(err(CancelledError()));
    if (this.outcome) return Promise.resolve(this.outcome);
    return new Promise((resolve) => {
      const onAbort = () => {
        if (!this.subscribers.delete(subscriber)) return;
        resolve(err(CancelledError()));
        if (this.subscribers.size === 0) this.controller.abort();
      };
      const subscriber: Subscriber<T, P> = {
        onProgress,
        resolve: (result) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(result);
        },
      };
      this.subscribers.add(subscriber);
      if (this.latest !== undefined) onProgress?.(this.latest);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** The latest progress event, for a status read between events (Settings' rows). */
  get progress(): P | undefined {
    return this.latest;
  }

  /** True once the work was told to stop; it may still be cleaning up. Don't join such a task. */
  get aborted(): boolean {
    return this.controller.signal.aborted;
  }

  /** Aborts the work for everyone. Callers still waiting get its result (usually core.cancelled). */
  cancel(): void {
    this.controller.abort();
  }
}
