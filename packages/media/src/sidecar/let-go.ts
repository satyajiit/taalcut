// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a helper process may still be working on (IX2-F4). A request's caller can learn its outcome before the
 * helper has let go of it: a cancel whose answer did not come within its grace settles anyway. A request asked
 * with `onLetGo` is held here, by id and process, until the helper really has let go of it: its reply comes
 * (late or not, a cancel's included) or its process exits. Nothing here signals a process.
 */
import type { JsonLineMessage } from './json-line-types';

interface Held {
  readonly process: object;
  readonly letGo: () => void;
}

export interface LetGoTracker {
  /** `letGo` (when given) runs once, when `process` answers `id` or exits. */
  hold(id: string, process: object, letGo: (() => void) | undefined): void;
  /** A line from the helper: a response lets go of its request, also one whose caller stopped waiting. */
  read(message: JsonLineMessage): void;
  /** `process` exited: it holds nothing any more. */
  exited(process: object): void;
  /** `process` failed: one that never started holds nothing; a started one lets go when it exits. */
  failed(process: { readonly pid?: number | undefined }): void;
  /** A request that was never sent: nothing holds it, so `letGo` runs now; `result` is passed through. */
  unsent<T>(result: T, letGo: (() => void) | undefined): T;
}

export function createLetGoTracker(): LetGoTracker {
  const held = new Map<string, Held>();
  const release = (ids: readonly string[]) => {
    for (const id of ids) {
      const entry = held.get(id);
      held.delete(id);
      try {
        entry?.letGo();
      } catch (cause) {
        // A throwing callback is the caller's bug; the other requests are still let go.
        console.error('[media] sidecar onLetGo threw', cause);
      }
    }
  };
  const exited = (process: object) =>
    release([...held].filter(([, entry]) => entry.process === process).map(([id]) => id));
  return {
    hold(id, process, letGo) {
      if (letGo) held.set(id, { process, letGo });
    },
    read(message) {
      if (message.type === 'response') release([message.id ?? '']);
    },
    exited,
    failed(process) {
      if (process.pid === undefined) exited(process);
    },
    unsent(result, letGo) {
      letGo?.();
      return result;
    },
  };
}
