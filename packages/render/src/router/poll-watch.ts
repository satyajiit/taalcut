// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A watched value read from the store: yielded now, then again whenever it changes. Progress in this process
 * wakes it at once (LiveRenders); writes from other processes (the agent's commands) are seen on the next
 * poll. Values are compared by their JSON, so an unchanged read yields nothing.
 */
import type { LiveRenders } from '../engine/live';

export async function* pollWatch<T>(
  read: () => Promise<T>,
  live: Pick<LiveRenders, 'onChange'>,
  signal: AbortSignal,
  pollMs: number,
): AsyncGenerator<T> {
  let last = '';
  let dirty = false;
  let wake: (() => void) | null = null;
  const unsubscribe = live.onChange(() => {
    dirty = true;
    wake?.();
  });
  const onAbort = () => wake?.();
  signal.addEventListener('abort', onAbort);
  try {
    while (!signal.aborted) {
      dirty = false;
      const value = await read();
      const serial = JSON.stringify(value);
      if (serial !== last) {
        last = serial;
        yield value;
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          wake = null;
          resolve();
        };
        const timer = setTimeout(done, pollMs);
        wake = done;
        if (dirty || signal.aborted) done();
      });
    }
  } finally {
    unsubscribe();
    signal.removeEventListener('abort', onAbort);
  }
}
