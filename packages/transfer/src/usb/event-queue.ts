// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A single-consumer queue of hot-plug events, drained until a signal aborts.
 * Each wait adds one abort listener and removes it again when it wakes, so a
 * watch that runs for hours does not pile up listeners on its signal.
 */
export interface EventQueue<T> {
  push(item: T): void;
  /** Queued items first, then live ones, until `signal` aborts. */
  drain(signal: AbortSignal): AsyncGenerator<T>;
}

export function createEventQueue<T>(): EventQueue<T> {
  const queue: T[] = [];
  let wake: (() => void) | null = null;

  function next(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal.aborted || queue.length > 0) {
        resolve();
        return;
      }
      const done = (): void => {
        signal.removeEventListener('abort', done);
        if (wake === done) wake = null;
        resolve();
      };
      wake = done;
      signal.addEventListener('abort', done, { once: true });
    });
  }

  return {
    push(item) {
      queue.push(item);
      const notify = wake;
      wake = null;
      notify?.();
    },
    async *drain(signal) {
      while (!signal.aborted) {
        if (queue.length > 0) {
          const [item] = queue.splice(0, 1);
          if (item !== undefined) yield item;
          continue;
        }
        await next(signal);
      }
    },
  };
}
