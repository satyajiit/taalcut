// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A one-reader queue for a watch loop: `take` waits for the next item, or undefined once closed or aborted. */
export class Gate<T> {
  private readonly items: T[] = [];
  private readonly waiters: ((value: T | undefined) => void)[] = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }
    this.items.push(item);
  }

  take(signal: AbortSignal): Promise<T | undefined> {
    if (this.closed) return Promise.resolve(undefined);
    const queued = this.items.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (signal.aborted) return Promise.resolve(undefined);
    return new Promise((resolveItem) => {
      const waiter = (value: T | undefined): void => {
        signal.removeEventListener('abort', onAbort);
        resolveItem(value);
      };
      const onAbort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolveItem(undefined);
      };
      this.waiters.push(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (waiter) waiter(undefined);
    }
  }
}
