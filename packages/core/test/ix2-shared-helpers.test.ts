// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Round IX2's fix pass (IX2-F8): helpers two packages each kept a copy of. */
import { describe, expect, it } from 'vitest';
import { CancelledError, err, ok, raceAbort, uniqueBy, type Result } from '../src/index';

describe('uniqueBy (core-requests-fusion F1)', () => {
  it('keeps the first item of each key, in order', () => {
    const items = [
      { id: 'b', n: 1 },
      { id: 'a', n: 2 },
      { id: 'b', n: 3 },
    ];
    expect(uniqueBy(items, (item) => item.id)).toEqual([
      { id: 'b', n: 1 },
      { id: 'a', n: 2 },
    ]);
    expect(uniqueBy([], (item: string) => item)).toEqual([]);
  });

  it('compares keys as a Set does: equal primitives are one key, distinct objects are not', () => {
    expect(uniqueBy([1, 2, 1, 3, 2], (n) => n % 2)).toEqual([1, 2]);
    const shared = { k: 1 };
    expect(uniqueBy([shared, { k: 1 }, shared], (item) => item)).toEqual([shared, { k: 1 }]);
  });
});

describe('raceAbort (core-requests-shotproc C1)', () => {
  it('is the work itself without a signal, and its result when it settles first', async () => {
    const work = Promise.resolve(ok(1));
    expect(raceAbort(work, undefined)).toBe(work);
    const controller = new AbortController();
    expect(await raceAbort(Promise.resolve(ok(2)), controller.signal)).toEqual(ok(2));
    const failed = err(CancelledError(undefined, { detail: 'the work said so' }));
    expect(await raceAbort(Promise.resolve(failed), controller.signal)).toBe(failed);
  });

  it('cancels at once when the signal aborts first, and drops the work’s later result', async () => {
    const controller = new AbortController();
    const { promise: work, resolve: settle } = Promise.withResolvers<Result<number>>();
    const raced = raceAbort(work, controller.signal);
    controller.abort();
    const result = await raced;
    expect(!result.ok && CancelledError.is(result.error)).toBe(true);
    settle(ok(3));
    expect(await work).toEqual(ok(3));
  });

  it('cancels without waiting when the signal has already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { promise: work } = Promise.withResolvers<Result<number>>();
    const result = await raceAbort(work, controller.signal);
    expect(!result.ok && CancelledError.is(result.error)).toBe(true);
  });
});
