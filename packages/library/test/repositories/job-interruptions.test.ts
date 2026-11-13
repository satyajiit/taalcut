// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 10: a job's `interruptions` live in its row. A restarted jobs
 * process takes over the dead boot's lease with `fail(…, { interruption })`,
 * which counts the interruption and decides, in one transaction, whether the
 * attempt is given back. Every "boot" here reopens the database file, as the
 * jobs process does after a crash.
 */
import { join } from 'node:path';
import { newId, ProcessRestartedError, unwrap, type JobId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createJobRepository, LIBRARY_MIGRATIONS, openDatabase } from '../../src/index';
import { tempDir } from '../helpers';

const FREE = 2;

/** One boot: open the file, take over leases older boots left, claim, then die without releasing. */
function boot(path: string, n: number) {
  const db = unwrap(openDatabase({ path }));
  try {
    const jobs = createJobRepository(db);
    const owner = `jobs:boot-${n}`;
    const takenOver = jobs
      .list({ states: ['running'] })
      .filter((job) => job.leaseOwner !== null && job.leaseOwner !== owner)
      .map((job) =>
        unwrap(
          jobs.fail(job.id, job.leaseOwner!, ProcessRestartedError({ process: 'jobs' }), {
            retryAt: db.clock(),
            interruption: { free: FREE },
          }),
        ),
      );
    const claimed = unwrap(jobs.claimNext({ owner, leaseMs: 10 * 60_000 }));
    return { takenOver, claimed };
  } finally {
    db.close(); // the process dies holding the lease
  }
}

describe('job interruptions across restarts (migration 10)', () => {
  it('gives the first two interrupted attempts back, counts later ones, and fails a crash loop', () => {
    const path = join(tempDir(), 'library.db');
    const first = unwrap(openDatabase({ path }));
    const { id } = unwrap(
      createJobRepository(first).enqueue({
        kind: 'media.crash',
        payload: {},
        resourceClass: 'cpu',
        maxAttempts: 2,
      }),
    ).job;
    first.close();

    const seen: { interruptions: number | null; state: string | null; attempt: number | null }[] = [];
    for (let n = 1; n <= 8; n++) {
      const { takenOver, claimed } = boot(path, n);
      const took = takenOver.find((job) => job.id === id);
      seen.push({
        interruptions: took?.interruptions ?? null,
        state: took?.state ?? null,
        attempt: claimed?.id === id ? claimed.attempts : null,
      });
      if (took?.state === 'failed') break;
    }
    expect(seen).toEqual([
      { interruptions: null, state: null, attempt: 1 }, // boot 1 claims
      { interruptions: 1, state: 'queued', attempt: 1 }, // free: the attempt was given back
      { interruptions: 2, state: 'queued', attempt: 1 }, // free
      { interruptions: 3, state: 'queued', attempt: 2 }, // counted
      { interruptions: 4, state: 'failed', attempt: null }, // counted, and out of attempts
    ]);
    const db = unwrap(openDatabase({ path }));
    expect(unwrap(createJobRepository(db).get(id as JobId))).toMatchObject({
      state: 'failed',
      attempts: 2,
      interruptions: 4,
      error: { code: 'core.process_restarted' },
    });
    db.close();
  });

  it('leaves the count alone for ordinary failures and for a lease that was not ours', () => {
    const path = join(tempDir(), 'library.db');
    const db = unwrap(openDatabase({ path }));
    const jobs = createJobRepository(db);
    const { id } = unwrap(jobs.enqueue({ kind: 'k.k', payload: {}, resourceClass: 'io' })).job;
    unwrap(jobs.claimNext({ owner: 'a', leaseMs: 1000 }));
    expect(unwrap(jobs.fail(id, 'a', { code: 'x' }, { retryAt: db.clock() })).interruptions).toBe(0);
    unwrap(jobs.claimNext({ owner: 'b', leaseMs: 1000 }));
    const wrongOwner = jobs.fail(id, 'a', null, { interruption: { free: FREE } });
    expect(wrongOwner.ok).toBe(false);
    expect(unwrap(jobs.get(id)).interruptions).toBe(0);
    db.close();
  });

  it('adds the column with 0 for existing jobs, and drops it going down', () => {
    const path = join(tempDir(), 'library.db');
    const v9 = unwrap(openDatabase({ path, targetVersion: 9 }));
    // Written as the v9 schema had it (the repository already knows the new column).
    const id = newId<'Job'>();
    v9.driver
      .prepare(
        `INSERT INTO jobs (id, kind, state, resource_class, payload, created_at, updated_at)
         VALUES (?, 'k.k', 'queued', 'io', '{}', 1, 1)`,
      )
      .run(id);
    v9.close();
    const db = unwrap(openDatabase({ path }));
    expect(db.schemaVersion()).toBe(LIBRARY_MIGRATIONS.length);
    expect(unwrap(createJobRepository(db).get(id)).interruptions).toBe(0);
    unwrap(db.migrateTo(9));
    const columns = db.driver
      .prepare('PRAGMA table_info(jobs)')
      .all()
      .map((c) => c.name);
    expect(columns).not.toContain('interruptions');
    db.close();
  });
});
