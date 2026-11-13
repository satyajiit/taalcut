// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A gate for a store that must tidy up after a crash before it does anything else (the consent store's orphan
 * sweep, review H4). The returned wrapper runs `sweep` once, before the first operation it wraps, and holds every
 * wrapped operation until it is done, so the sweep never runs beside one. A sweep that failed returns its error and
 * is tried again by the next operation.
 */
import type { AsyncResult, Result } from '@taalcut/core';

export function sweepFirst(sweep: () => AsyncResult<void>) {
  let swept: AsyncResult<void> | undefined;
  const ready = (): AsyncResult<void> => {
    swept ??= sweep().then((done) => {
      if (!done.ok) swept = undefined;
      return done;
    });
    return swept;
  };
  return <A extends unknown[], T>(work: (...args: A) => AsyncResult<T> | Result<T>) =>
    async (...args: A): AsyncResult<T> => {
      const done = await ready();
      return done.ok ? work(...args) : done;
    };
}
