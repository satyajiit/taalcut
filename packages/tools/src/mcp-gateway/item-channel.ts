// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A one-reader queue between a callback (the runner's progress) and an async generator: items pushed before the
 * channel closes are all yielded, in order, then the drain ends.
 */
export interface ItemChannel<T extends object> {
  push(item: T): void;
  /** No more items; the drain ends once the queue is empty. */
  close(): void;
  readonly closed: boolean;
  drain(): AsyncGenerator<T, void, undefined>;
}

export function createItemChannel<T extends object>(): ItemChannel<T> {
  const queue: T[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  return {
    push(item) {
      queue.push(item);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    get closed() {
      return closed;
    },
    async *drain() {
      while (!closed || queue.length > 0) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        await new Promise<void>((resolve) => (wake = resolve));
        wake = undefined;
      }
    },
  };
}
