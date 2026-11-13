// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A tiny async queue. `push` never blocks; `next` waits. `close` ends the iterator. */
export function createQueue<T>() {
  const items: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;

  function push(item: T): void {
    if (closed) return;
    const waiter = waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else items.push(item);
  }

  function close(): void {
    if (closed) return;
    closed = true;
    for (const waiter of waiters) waiter({ value: undefined as T, done: true });
    waiters.length = 0;
  }

  function next(): Promise<IteratorResult<T>> {
    const item = items.shift();
    if (item !== undefined) return Promise.resolve({ value: item, done: false });
    if (closed) return Promise.resolve({ value: undefined as T, done: true });
    return new Promise((resolve) => waiters.push(resolve));
  }

  return { push, close, next };
}

export type ItemQueue<T> = ReturnType<typeof createQueue<T>>;
