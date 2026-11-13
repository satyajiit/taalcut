// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-S4: the job order key (migration 25). Claims go priority descending, then the order key ascending
 * with jobs without one last, then the time the job became runnable, then id; the claim walks
 * `jobs_claim_order_idx` instead of sorting; old rows read as jobs without a key.
 */
import { newId, unwrap, type JobRecord } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createJobStore, createRepositories, type JobEnqueue, type LibraryDatabase } from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';

function setup() {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  return { db, clock, jobs: createRepositories(db).jobs };
}

const job = (extra: Partial<JobEnqueue> = {}): JobEnqueue => ({
  kind: 'vision.detectShots',
  payload: { asset: 1 },
  resourceClass: 'video',
  ...extra,
});

const lease = { owner: 'worker-1', leaseMs: 30_000 };
const all = (db: LibraryDatabase, text: string, ...params: (string | number)[]) =>
  db.driver.prepare(text).all(...params);

describe('job order key', () => {
  it('claims by priority, then order key (none last), then the time it became due, then id', () => {
    const { jobs, clock } = setup();
    const noKey = unwrap(jobs.enqueue(job({ priority: -10 }))).job;
    clock.advance(1);
    const asset3 = unwrap(jobs.enqueue(job({ priority: -10, orderKey: 3 }))).job;
    clock.advance(1);
    const asset1Late = unwrap(jobs.enqueue(job({ priority: -10, orderKey: 1 }))).job;
    clock.advance(1);
    const asset2 = unwrap(jobs.enqueue(job({ priority: -10, orderKey: 2 }))).job;
    const boosted = unwrap(jobs.enqueue(job({ priority: 10, orderKey: 9 }))).job;
    const negative = unwrap(jobs.enqueue(job({ priority: -10, orderKey: -5 }))).job;
    const retried = unwrap(jobs.enqueue(job({ priority: -10, orderKey: 1, runAt: clock.now() - 10 }))).job;
    const claimed: string[] = [];
    for (let next = unwrap(jobs.claimNext(lease)); next; next = unwrap(jobs.claimNext(lease)))
      claimed.push(next.id);
    expect(claimed).toEqual([
      boosted.id,
      negative.id,
      retried.id,
      asset1Late.id,
      asset2.id,
      asset3.id,
      noKey.id,
    ]);
  });

  it('keeps the key on the row and through core’s JobStore port', async () => {
    const { db, jobs } = setup();
    const keyed = unwrap(jobs.enqueue(job({ orderKey: 1_760_000_000_000 }))).job;
    expect(keyed.orderKey).toBe(1_760_000_000_000);
    expect(unwrap(jobs.enqueue(job())).job.orderKey).toBeNull();

    const store = createJobStore(db);
    expect(unwrap(await store.get(keyed.id)).orderKey).toBe(1_760_000_000_000);
    const record: JobRecord = {
      ...unwrap(await store.get(keyed.id)),
      id: newId<'Job'>(),
      idempotencyKey: null,
      orderKey: 42,
    };
    expect(unwrap(await store.insert(record)).job.orderKey).toBe(42);
    // A record written before round IX has no key; it reads back the same, without one.
    const { orderKey: _orderKey, ...old } = { ...record, id: newId<'Job'>() };
    const stored = unwrap(await store.insert(old)).job;
    expect('orderKey' in stored).toBe(false);
    expect(all(db, 'SELECT order_key AS k FROM jobs WHERE id = ?', stored.id)).toEqual([{ k: null }]);
  });

  it('claims by walking jobs_claim_order_idx, without sorting the queue', () => {
    const { db } = setup();
    // The claim's ORDER BY as Drizzle writes it for repositories/jobs.ts.
    const plan = all(
      db,
      `EXPLAIN QUERY PLAN SELECT "id" FROM "jobs" WHERE ("jobs"."state" = 'queued'
         AND ("jobs"."next_run_at" IS NULL OR "jobs"."next_run_at" <= 5) AND "jobs"."resource_class" = 'video'
         AND "jobs"."kind" IN ('vision.detectShots', 'media.normalise'))
       ORDER BY "jobs"."priority" desc, ("jobs"."order_key" IS NULL) asc, "jobs"."order_key" asc,
         coalesce("jobs"."next_run_at", "jobs"."created_at") asc, "jobs"."id" asc LIMIT 1`,
    ).map((row) => String(row.detail));
    expect(plan).toEqual(['SEARCH jobs USING INDEX jobs_claim_order_idx (state=? AND resource_class=?)']);
  });

  it('migration 25 adds the column and the index, and goes down and up again', () => {
    const db = openTestDb({ targetVersion: 24 });
    const insert = db.driver.prepare(
      `INSERT INTO jobs (id, kind, state, priority, resource_class, payload, created_at, updated_at)
       VALUES (?, 'media.normalise', 'queued', 0, 'video', '{}', 1, 1)`,
    );
    const old = newId<'Job'>();
    insert.run(old);
    const indexes = () =>
      all(db, "SELECT name FROM sqlite_schema WHERE type = 'index' AND name LIKE 'jobs_claim%'").map(
        (row) => row.name,
      );
    expect(indexes()).toEqual(['jobs_claim_idx']);

    unwrap(db.migrateTo(25));
    expect(indexes()).toEqual(['jobs_claim_order_idx']);
    expect(all(db, 'SELECT order_key AS k FROM jobs WHERE id = ?', old)).toEqual([{ k: null }]);
    expect(() => db.driver.prepare(`UPDATE jobs SET order_key = 'first' WHERE id = ?`).run(old)).toThrow(); // STRICT: an integer or nothing

    unwrap(db.migrateTo(24));
    expect(indexes()).toEqual(['jobs_claim_idx']);
    expect(all(db, "SELECT name FROM pragma_table_info('jobs') WHERE name = 'order_key'")).toEqual([]);
    expect(all(db, 'SELECT count(*) AS n FROM jobs')).toEqual([{ n: 1 }]);
    unwrap(db.migrateTo(25));
    expect(indexes()).toEqual(['jobs_claim_order_idx']);
  });
});
