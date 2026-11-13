// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A bounded number of OCR requests at once (IX-O6): the helper runs two at a time and queues the rest. */
import { err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';

/**
 * Runs `count` jobs, at most `limit` at once, results in job order; the first
 * failure stops new jobs from starting and is returned once the running ones end.
 */
export async function inFlight<T>(
  count: number,
  limit: number,
  job: (n: number) => AsyncResult<T>,
): AsyncResult<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  let failed: TaalcutError | undefined;
  const worker = async () => {
    while (failed === undefined && next < count) {
      const n = next++;
      const result = await job(n);
      if (result.ok) results[n] = result.value;
      else failed ??= result.error;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, count)) }, worker));
  return failed === undefined ? ok(results) : err(failed);
}
