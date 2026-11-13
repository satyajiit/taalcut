// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A value served the way core's `changed` procedures are: the current value
 * first, then the value after each change, until the reader stops or the
 * signal aborts. Changes that land while the reader is busy collapse into one:
 * a settings screen wants the latest state, not every step.
 */
export interface Watched<T> {
  notify(): void;
  stream(signal?: AbortSignal): AsyncGenerator<T, void, undefined>;
}

export function watched<T>(get: () => T | Promise<T>): Watched<T> {
  const waiters = new Set<() => void>();
  let version = 0;
  return {
    notify() {
      version += 1;
      for (const wake of [...waiters]) wake();
    },
    async *stream(signal) {
      let seen = version;
      yield await get();
      while (!signal?.aborted) {
        if (seen === version) {
          await new Promise<void>((resolve) => {
            const wake = () => {
              waiters.delete(wake);
              signal?.removeEventListener('abort', wake);
              resolve();
            };
            waiters.add(wake);
            signal?.addEventListener('abort', wake, { once: true });
          });
          continue;
        }
        seen = version;
        yield await get();
      }
    },
  };
}
