// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The in-memory fallback of the hardware session gate: the same weights, this process only, first come first served. */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { MediaCancelled } from '../errors';
import type { HardwareSessionLease } from './types';

interface Waiting {
  readonly want: number;
  readonly max: number;
  readonly grant: () => void;
}

export interface LocalSemaphore {
  acquire(want: number, max: number, signal?: AbortSignal): AsyncResult<HardwareSessionLease>;
  inUse(): number;
}

export function createLocalSemaphore(): LocalSemaphore {
  let used = 0;
  const queue: Waiting[] = [];

  const lease = (want: number): HardwareSessionLease => {
    let released = false;
    return {
      weight: want,
      release: () => {
        if (!released) {
          released = true;
          used -= want;
          pump();
        }
        return Promise.resolve();
      },
    };
  };
  function pump(): void {
    while (queue.length > 0 && used + queue[0]!.want <= queue[0]!.max) {
      const next = queue.shift()!;
      used += next.want;
      next.grant();
    }
  }

  return {
    acquire(want, max, signal) {
      if (signal?.aborted) return Promise.resolve(err(MediaCancelled()));
      if (queue.length === 0 && used + want <= max) {
        used += want;
        return Promise.resolve(ok(lease(want)));
      }
      return new Promise((resolve) => {
        const onAbort = () => {
          const at = queue.indexOf(entry);
          if (at >= 0) queue.splice(at, 1);
          resolve(err(MediaCancelled()));
          pump();
        };
        const entry: Waiting = {
          want,
          max,
          grant: () => {
            signal?.removeEventListener('abort', onAbort);
            resolve(ok(lease(want)));
          },
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        queue.push(entry);
      });
    },
    inUse: () => used,
  };
}
