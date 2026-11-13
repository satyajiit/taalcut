// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The open `transfer.devices` streams. Each one waits for its own wake-up, so
 * two windows both see every change, and an abort ends the wait at once.
 */
export interface StreamWait {
  /** The state just yielded is the current one. */
  delivered(): void;
  /** Resolves true at the next change, false once the stream's signal aborts. */
  next(): Promise<boolean>;
  close(): void;
}

export interface DeviceStreams {
  open(signal: AbortSignal): StreamWait;
  /** Something changed: every open stream yields again. */
  poke(): void;
  count(): number;
}

interface Waiter {
  dirty: boolean;
  wake: (() => void) | null;
}

export function createDeviceStreams(): DeviceStreams {
  const waiters = new Set<Waiter>();

  const wake = (waiter: Waiter): void => {
    const resolve = waiter.wake;
    waiter.wake = null;
    resolve?.();
  };

  return {
    open(signal) {
      const waiter: Waiter = { dirty: false, wake: null };
      const onAbort = (): void => wake(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
      waiters.add(waiter);
      return {
        delivered() {
          waiter.dirty = false;
        },
        async next() {
          if (!waiter.dirty && !signal.aborted) {
            await new Promise<void>((resolve) => {
              waiter.wake = resolve;
            });
          }
          return !signal.aborted;
        },
        close() {
          signal.removeEventListener('abort', onAbort);
          waiters.delete(waiter);
          wake(waiter);
        },
      };
    },
    poke() {
      for (const waiter of waiters) {
        waiter.dirty = true;
        wake(waiter);
      }
    },
    count: () => waiters.size,
  };
}
