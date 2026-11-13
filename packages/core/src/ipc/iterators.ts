// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Async-iterator helpers for streaming procedures. */

export function isAsyncIterator(value: unknown): value is AsyncIterator<unknown> & AsyncIterable<unknown> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AsyncIterator<unknown> & AsyncIterable<unknown>>;
  return typeof candidate.next === 'function' && typeof candidate[Symbol.asyncIterator] === 'function';
}

/**
 * Wraps an iterator so errors thrown while iterating are mapped, and each
 * value too when `mapValue` is given. Unlike an async generator wrapper,
 * `return()` reaches the inner iterator even before the first `next()`, so
 * cancelling a stream always cleans up the producer.
 */
export function mapIteratorErrors<T, R = unknown>(
  inner: AsyncIterator<T, R>,
  mapError: (cause: unknown) => unknown,
  mapValue?: (value: T) => T,
): AsyncIterableIterator<T, R> {
  const rethrow = (cause: unknown): never => {
    throw mapError(cause);
  };
  const map = (result: IteratorResult<T, R>): IteratorResult<T, R> =>
    !mapValue || result.done ? result : { done: false, value: mapValue(result.value) };
  const iterator: AsyncIterableIterator<T, R> = {
    next: () => inner.next().then(map, rethrow),
    return: (value?: R | PromiseLike<R>) =>
      inner.return
        ? inner.return(value).catch(rethrow)
        : Promise.resolve(value).then((done) => ({ done: true as const, value: done as R })),
    throw: (cause?: unknown) =>
      inner.throw ? inner.throw(cause).catch(rethrow) : Promise.reject(mapError(cause)),
    [Symbol.asyncIterator]: () => iterator,
  };
  return iterator;
}

/**
 * A watched value as a stream: the current value first, then every change (only the latest when several arrive
 * at once), until `signal` fires. `subscribe` returns its unsubscribe function.
 */
export async function* latestValues<T>(
  current: () => T,
  subscribe: (listener: (value: T) => void) => () => void,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  let pending: { value: T } | undefined = { value: current() };
  let wake: (() => void) | undefined;
  const off = subscribe((value) => {
    pending = { value };
    wake?.();
  });
  const onAbort = (): void => wake?.();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (!signal?.aborted) {
      if (pending) {
        const next = pending.value;
        pending = undefined;
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => (wake = resolve));
      wake = undefined;
    }
  } finally {
    off();
    signal?.removeEventListener('abort', onAbort);
  }
}
