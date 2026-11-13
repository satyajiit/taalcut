// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The durable job queue's storage (PRD G7). The scheduler (plan P1-E1) owns
 * concurrency, backoff and progress events; this owns atomic state changes.
 * Workers hold a lease while running; after a crash, expired leases go back to
 * the queue (recoverExpiredLeases), so jobs resume.
 *
 *   queued ──claim──▶ running ──complete──▶ succeeded
 *     ▲  │              │  └──fail──▶ queued (retryAt, attempts left) | failed
 *     │  └─pause─▶ paused ◀─pause─┘
 *     └──resume──┘     any non-final state ──cancel──▶ cancelled
 */
import {
  err,
  newId,
  ok,
  ProcessRestartedError,
  ValidationError,
  type JobId,
  type JobState,
  type ProjectId,
  type ResourceClass,
  type Result,
} from '@taalcut/core';
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core';
import type { LibraryDatabase } from '../db/database';
import { InvalidState } from '../errors';
import { jobs, LIVE_JOB_STATES } from '../schema/jobs';
import { found, inTransaction, pageSize } from './shared';

export type Job = typeof jobs.$inferSelect;

export interface JobEnqueue {
  readonly id?: JobId;
  readonly kind: string;
  readonly payload: unknown;
  readonly resourceClass: ResourceClass;
  /** Higher runs first. Default 0. */
  readonly priority?: number;
  /** Default 3. */
  readonly maxAttempts?: number;
  /**
   * Enqueuing a key held by a queued, running, paused or succeeded job returns
   * that job (created: false); a failed or cancelled one doesn't block a new job.
   */
  readonly idempotencyKey?: string | null;
  /** Not before this time. Default: now. */
  readonly runAt?: number;
  readonly projectId?: ProjectId | null;
  /** Claim order within a priority, lower first; absent: after every job that has one (core's jobOrderKeySchema). */
  readonly orderKey?: number;
}

export interface JobClaim {
  /** Worker id, e.g. 'jobs-process:<pid>'. */
  readonly owner: string;
  readonly leaseMs: number;
  readonly resourceClass?: ResourceClass;
  readonly kinds?: readonly string[];
  /** Only these jobs: the engine claims a running job's children by id, outside the class's limit. */
  readonly ids?: readonly JobId[];
}

/**
 * The lease-based queue storage that @taalcut/jobs' engine uses (its JobStore
 * port). Core's record-based JobStore port is in ports/job-store.ts.
 */
export interface JobLeaseRepository {
  enqueue(input: JobEnqueue): Result<{ job: Job; created: boolean }>;
  get(id: JobId): Result<Job>;
  /** The live job (queued, running, paused, succeeded) holding this key. */
  findByIdempotencyKey(key: string): Job | undefined;
  /**
   * Atomically takes the next due job, or null. Counts an attempt. Order: priority descending, then the
   * order key ascending with jobs without one last, then the time it became runnable, then id.
   */
  claimNext(claim: JobClaim): Result<Job | null>;
  /** Extends the lease and records progress. InvalidState 'lease_lost' if paused, cancelled or reclaimed. */
  heartbeat(
    id: JobId,
    owner: string,
    update: { leaseMs: number; progress?: number | null; progressDetail?: unknown },
  ): Result<Job>;
  complete(id: JobId, owner: string, result?: unknown): Result<Job>;
  /**
   * Requeues at `retryAt` if given and attempts remain; otherwise the job fails for good. With
   * `interruption` (a restarted jobs process taking over a dead boot's lease), first adds one to
   * `interruptions` in the same transaction; while that is at most `free`, the attempt is given back
   * instead (requeued at `retryAt` or now, attempts - 1).
   */
  fail(
    id: JobId,
    owner: string,
    error: unknown,
    options?: { retryAt?: number; interruption?: { readonly free: number } },
  ): Result<Job>;
  /**
   * running → queued, due now, giving the attempt back: the worker is shutting
   * down or the queue was paused, so this attempt didn't fail.
   */
  release(id: JobId, owner: string): Result<Job>;
  /** queued|running → paused. Pausing a running job revokes its lease and gives the attempt back. */
  pause(id: JobId): Result<Job>;
  /** paused → queued, due now. */
  resume(id: JobId): Result<Job>;
  cancel(id: JobId): Result<Job>;
  /** Running jobs whose lease expired (their worker died) go back to the queue, or fail if out of attempts. */
  recoverExpiredLeases(): Result<Job[]>;
  /**
   * Like recoverExpiredLeases, but for every running job whatever its lease:
   * only safe at app start, before any worker runs. Every such job's process
   * died, so this is an interruption: it adds one to `interruptions` and gives
   * the attempt back while that is at most `freeRestarts` (default
   * `DEFAULT_FREE_RESTARTS`, the jobs engine's own default), then counts it.
   */
  reclaimRunning(options?: { readonly freeRestarts?: number }): Result<Job[]>;
  /** Highest priority first, then oldest. */
  list(options?: { states?: readonly JobState[]; kind?: string; limit?: number }): Job[];
}

const FINAL: readonly JobState[] = ['succeeded', 'failed', 'cancelled'];

/** Process restarts that give a job's attempt back; the same default as `@taalcut/jobs`' engine. */
export const DEFAULT_FREE_RESTARTS = 2;

/** The claim order, as `jobs_claim_order_idx` (migration 25) lists it, so a claim walks that index. */
const claimOrder = [
  desc(jobs.priority),
  asc(sql`(${jobs.orderKey} IS NULL)`),
  asc(jobs.orderKey),
  asc(sql`coalesce(${jobs.nextRunAt}, ${jobs.createdAt})`),
  asc(jobs.id),
];

export function createJobRepository(db: LibraryDatabase): JobLeaseRepository {
  const { orm } = db;
  const get = (id: JobId) => found(orm.select().from(jobs).where(eq(jobs.id, id)).get(), 'job', id);
  const findByIdempotencyKey = (key: string) =>
    orm
      .select()
      .from(jobs)
      .where(and(eq(jobs.idempotencyKey, key), inArray(jobs.state, [...LIVE_JOB_STATES])))
      .get();
  const update = (id: JobId, changes: SQLiteUpdateSetSource<typeof jobs>) =>
    orm
      .update(jobs)
      .set({ ...changes, updatedAt: db.clock() })
      .where(eq(jobs.id, id))
      .returning()
      .get()!;
  const invalid = (state: string) => err(InvalidState({ entity: 'job', state }));
  const released = { leaseOwner: null, leaseExpiresAt: null } as const;

  /** Loads a running job held by `owner`, or explains why not. */
  function held(id: JobId, owner: string): Result<Job> {
    const current = get(id);
    if (!current.ok) return current;
    const job = current.value;
    if (job.state !== 'running' || job.leaseOwner !== owner) return invalid('lease_lost');
    return ok(job);
  }

  /**
   * Running jobs (with an expired lease, or all) back to the queue, or failed when out of attempts.
   * With `free` (app start: every running job's process died), the interruption is counted in the
   * row and the attempt given back while the count is at most `free`, the rule `fail` applies when
   * an exclusive engine takes a dead boot's lease over.
   */
  function reclaim(expiredOnly: boolean, free?: number): Result<Job[]> {
    return inTransaction(db, 'job', () => {
      const now = db.clock();
      const stale = orm
        .select()
        .from(jobs)
        .where(and(eq(jobs.state, 'running'), expiredOnly ? lte(jobs.leaseExpiresAt, now) : undefined))
        .all();
      const error = ProcessRestartedError({ process: 'jobs' });
      return ok(
        stale.map((job) => {
          if (free === undefined) {
            return job.attempts < job.maxAttempts
              ? update(job.id, { state: 'queued', nextRunAt: now, ...released })
              : update(job.id, { state: 'failed', error, ...released, finishedAt: now });
          }
          const interruptions = job.interruptions + 1;
          // A free interruption gives the attempt back, as `fail(…, { interruption })` does.
          const attempts = interruptions <= free ? Math.max(0, job.attempts - 1) : job.attempts;
          const base = { interruptions, attempts, error, ...released };
          return attempts < job.maxAttempts
            ? update(job.id, { ...base, state: 'queued', nextRunAt: now })
            : update(job.id, { ...base, state: 'failed', finishedAt: now });
        }),
      );
    });
  }

  return {
    enqueue(input) {
      if (!input.kind.trim()) return err(ValidationError({ field: 'kind' }));
      if (input.payload == null) return err(ValidationError({ field: 'payload' }));
      return inTransaction<{ job: Job; created: boolean }>(db, 'job', () => {
        if (input.idempotencyKey) {
          const existing = findByIdempotencyKey(input.idempotencyKey);
          if (existing) return ok({ job: existing, created: false });
        }
        const now = db.clock();
        const job = orm
          .insert(jobs)
          .values({
            id: input.id ?? newId<'Job'>(),
            kind: input.kind,
            state: 'queued',
            priority: input.priority ?? 0,
            resourceClass: input.resourceClass,
            attempts: 0,
            maxAttempts: input.maxAttempts ?? 3,
            nextRunAt: input.runAt ?? now,
            idempotencyKey: input.idempotencyKey ?? null,
            payload: input.payload,
            projectId: input.projectId ?? null,
            orderKey: input.orderKey ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        return ok({ job, created: true });
      });
    },
    get,
    findByIdempotencyKey,
    claimNext(claim) {
      return inTransaction(db, 'job', () => {
        const now = db.clock();
        const next = orm
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              eq(jobs.state, 'queued'),
              or(isNull(jobs.nextRunAt), lte(jobs.nextRunAt, now)),
              claim.resourceClass ? eq(jobs.resourceClass, claim.resourceClass) : undefined,
              claim.kinds ? inArray(jobs.kind, [...claim.kinds]) : undefined,
              claim.ids ? inArray(jobs.id, [...claim.ids]) : undefined,
            ),
          )
          .orderBy(...claimOrder)
          .limit(1)
          .get();
        if (!next) return ok(null);
        return ok(
          update(next.id, {
            state: 'running',
            attempts: sql`${jobs.attempts} + 1`,
            leaseOwner: claim.owner,
            leaseExpiresAt: now + claim.leaseMs,
            startedAt: sql`coalesce(${jobs.startedAt}, ${now})`,
          }),
        );
      });
    },
    heartbeat(id, owner, progress) {
      if (progress.progress != null && !(progress.progress >= 0 && progress.progress <= 1)) {
        return err(ValidationError({ field: 'progress' }));
      }
      return inTransaction(db, 'job', () => {
        const job = held(id, owner);
        if (!job.ok) return job;
        const changes: SQLiteUpdateSetSource<typeof jobs> = { leaseExpiresAt: db.clock() + progress.leaseMs };
        if (progress.progress !== undefined) changes.progress = progress.progress;
        if (progress.progressDetail !== undefined) changes.progressDetail = progress.progressDetail;
        return ok(update(id, changes));
      });
    },
    complete(id, owner, result) {
      return inTransaction(db, 'job', () => {
        const job = held(id, owner);
        if (!job.ok) return job;
        const done = { state: 'succeeded', result: result ?? null, progress: 1, error: null } as const;
        return ok(update(id, { ...done, ...released, finishedAt: db.clock() }));
      });
    },
    fail(id, owner, error, options = {}) {
      return inTransaction(db, 'job', () => {
        const job = held(id, owner);
        if (!job.ok) return job;
        const interruptions = job.value.interruptions + (options.interruption ? 1 : 0);
        const base = { error: error ?? null, interruptions, ...released };
        if (options.interruption && interruptions <= options.interruption.free) {
          const attempts = Math.max(0, job.value.attempts - 1); // a free interruption: the attempt is given back
          return ok(
            update(id, { ...base, state: 'queued', attempts, nextRunAt: options.retryAt ?? db.clock() }),
          );
        }
        const retry = options.retryAt !== undefined && job.value.attempts < job.value.maxAttempts;
        if (retry) return ok(update(id, { ...base, state: 'queued', nextRunAt: options.retryAt }));
        return ok(update(id, { ...base, state: 'failed', finishedAt: db.clock() }));
      });
    },
    release(id, owner) {
      return inTransaction(db, 'job', () => {
        const job = held(id, owner);
        if (!job.ok) return job;
        const attempts = Math.max(0, job.value.attempts - 1);
        return ok(update(id, { state: 'queued', attempts, nextRunAt: db.clock(), ...released }));
      });
    },
    pause(id) {
      return inTransaction(db, 'job', () => {
        const current = get(id);
        if (!current.ok) return current;
        const job = current.value;
        if (job.state === 'queued') return ok(update(id, { state: 'paused' }));
        if (job.state === 'running') {
          return ok(update(id, { state: 'paused', attempts: Math.max(0, job.attempts - 1), ...released }));
        }
        return invalid(job.state);
      });
    },
    resume(id) {
      return inTransaction(db, 'job', () => {
        const current = get(id);
        if (!current.ok) return current;
        if (current.value.state !== 'paused') return invalid(current.value.state);
        return ok(update(id, { state: 'queued', nextRunAt: db.clock() }));
      });
    },
    cancel(id) {
      return inTransaction(db, 'job', () => {
        const current = get(id);
        if (!current.ok) return current;
        if (FINAL.includes(current.value.state)) return invalid(current.value.state);
        return ok(update(id, { state: 'cancelled', ...released, finishedAt: db.clock() }));
      });
    },
    recoverExpiredLeases: () => reclaim(true),
    reclaimRunning: (options = {}) => reclaim(false, options.freeRestarts ?? DEFAULT_FREE_RESTARTS),
    list(options = {}) {
      return orm
        .select()
        .from(jobs)
        .where(
          and(
            options.states ? inArray(jobs.state, [...options.states]) : undefined,
            options.kind ? eq(jobs.kind, options.kind) : undefined,
          ),
        )
        .orderBy(desc(jobs.priority), asc(jobs.createdAt), asc(jobs.id))
        .limit(pageSize(options.limit, 500, 10_000))
        .all();
    },
  };
}
