// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app's main process opens the database with `reclaimJobs: 'all'` before
 * any utility process runs, so the jobs engine's exclusive start never sees a
 * running row to take over. A full quit is a process restart for every job
 * that was running, so the app-start reclaim applies the same free-restart
 * rule as the engine's takeover: count the interruption in the row and give
 * the attempt back while that count is at most `freeRestarts`. A one-attempt
 * job (a reference breakdown) then survives the first quits.
 */
import { join } from 'node:path';
import { unwrap, type JobId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createJobRepository, openDatabase } from '../../src/index';
import { tempDir } from '../helpers';

/** One app session: main reclaims at start, the jobs process claims, then the app quits holding the lease. */
function session(path: string, n: number) {
  const db = unwrap(openDatabase({ path, recovery: { reclaimJobs: 'all' } }));
  try {
    const reclaimed = db.opened.recovery.reclaimedJobs;
    const jobs = createJobRepository(db);
    // The engine's exclusive start: nothing is running any more, so there is nothing to take over.
    expect(jobs.list({ states: ['running'] })).toEqual([]);
    const claimed = unwrap(jobs.claimNext({ owner: `jobs:boot-${n}`, leaseMs: 10 * 60_000 }));
    return { reclaimed, claimed };
  } finally {
    db.close();
  }
}

describe('app-start reclaim and free restarts', () => {
  it('requeues a one-attempt job after the first two quits and fails it on the third', () => {
    const path = join(tempDir(), 'library.db');
    const first = unwrap(openDatabase({ path }));
    const { id } = unwrap(
      createJobRepository(first).enqueue({
        kind: 'templates.breakdown',
        payload: {},
        resourceClass: 'cpu',
        maxAttempts: 1,
      }),
    ).job;
    first.close();

    const seen: { reclaimed: string | null; attempt: number | null }[] = [];
    for (let n = 1; n <= 6; n++) {
      const { reclaimed, claimed } = session(path, n);
      seen.push({
        reclaimed: reclaimed.find((job) => job.id === id)?.state ?? null,
        attempt: claimed?.id === id ? claimed.attempts : null,
      });
      if (claimed?.id !== id) break;
    }
    expect(seen).toEqual([
      { reclaimed: null, attempt: 1 }, // session 1 claims, then the app quits
      { reclaimed: 'queued', attempt: 1 }, // free: the attempt was given back
      { reclaimed: 'queued', attempt: 1 }, // free
      { reclaimed: 'failed', attempt: null }, // counted, and a one-attempt job is out of attempts
    ]);
    const db = unwrap(openDatabase({ path, recovery: { reclaimJobs: 'none' } }));
    expect(unwrap(createJobRepository(db).get(id as JobId))).toMatchObject({
      state: 'failed',
      attempts: 1,
      interruptions: 3,
      error: { code: 'core.process_restarted' },
    });
    db.close();
  });

  it('honours a different free-restart allowance', () => {
    const path = join(tempDir(), 'library.db');
    const first = unwrap(openDatabase({ path }));
    const jobs = createJobRepository(first);
    const { id } = unwrap(
      jobs.enqueue({ kind: 'k.k', payload: {}, resourceClass: 'io', maxAttempts: 1 }),
    ).job;
    unwrap(jobs.claimNext({ owner: 'dead', leaseMs: 1 }));
    first.close();

    const strict = unwrap(openDatabase({ path, recovery: { reclaimJobs: 'all', freeRestarts: 0 } }));
    expect(strict.opened.recovery.reclaimedJobs.map((job) => job.state)).toEqual(['failed']);
    expect(unwrap(createJobRepository(strict).get(id)).interruptions).toBe(1);
    strict.close();
  });
});
