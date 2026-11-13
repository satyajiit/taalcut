// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Work that must not overlap, one task at a time in the order it was asked (LRN1-FIX). Packages each kept a
 * copy of this (a promise tail every call chains onto); this is the one definition.
 *
 * A task's result or failure is its own caller's. A task that throws or rejects never holds up the ones
 * queued after it. The queue keeps no hold on the promise it hands back, so a failure its caller drops is
 * reported as an unhandled rejection, like any other promise's, and is never absorbed here.
 */

/** Runs tasks one at a time, in call order. */
export interface SerialQueue {
  /** Runs `task` once every task queued before it has settled. Its result or failure is this call's. */
  run<T>(task: () => T | PromiseLike<T>): Promise<T>;
  /** Resolves, never rejects, once every task queued so far has settled. */
  settled(): Promise<void>;
}

/** Runs tasks one at a time per key, in call order; tasks under different keys run side by side. */
export interface KeyedQueue {
  /** Runs `task` once every earlier task under `key` has settled. Its result or failure is this call's. */
  run<T>(key: string, task: () => T | PromiseLike<T>): Promise<T>;
  /** Resolves, never rejects, once every task so far under `key` (under any key, without one) has settled. */
  settled(key?: string): Promise<void>;
}

const ignore = (): void => undefined;

/** `task` once `previous` has settled: the caller's promise, and the tail the next task waits on. */
function after<T>(
  previous: Promise<void>,
  task: () => T | PromiseLike<T>,
): { readonly result: Promise<T>; readonly tail: Promise<void> } {
  const ran = previous.then(() => task());
  // The caller's own promise, so the tail's handler never marks a failure handled. Made before the tail, so a
  // caller awaiting it resumes before the next task starts, as with a plain chain.
  const result = ran.then((value) => value);
  return { result, tail: ran.then(ignore, ignore) };
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    run<T>(task: () => T | PromiseLike<T>): Promise<T> {
      const next = after(tail, task);
      tail = next.tail;
      return next.result;
    },
    settled: () => tail,
  };
}

export function createKeyedQueue(): KeyedQueue {
  const tails = new Map<string, Promise<void>>();
  return {
    run<T>(key: string, task: () => T | PromiseLike<T>): Promise<T> {
      const next = after(tails.get(key) ?? Promise.resolve(), task);
      tails.set(key, next.tail);
      // An idle key is forgotten, unless a later task has taken its place.
      void next.tail.then(() => {
        if (tails.get(key) === next.tail) tails.delete(key);
      });
      return next.result;
    },
    async settled(key?: string): Promise<void> {
      await (key === undefined ? Promise.all(tails.values()) : tails.get(key));
    },
  };
}
