// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An in-memory JobStore with the same state machine as @taalcut/library's
 * SQLite JobStore. For tests and for jobs that needn't survive a restart.
 * `onChange` receives every record after each change, so a test can persist
 * snapshots to a file and simulate a crash.
 */
import { err, newId, NotFoundError, ok, ValidationError, type JobId, type Result } from '@taalcut/core';
import { InvalidJobState } from './errors';
import type { JobClaim, JobEnqueueInput, JobStore } from './ports';
import type { JobRecord, JobState } from './types';

const FINAL: readonly JobState[] = ['succeeded', 'failed', 'cancelled'];
const LIVE: readonly JobState[] = ['queued', 'running', 'paused', 'succeeded'];

/** Lower order keys first; jobs without one after every job that has one. */
const byOrderKey = (a: number | null, b: number | null): number =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b;

/** Core's claim order: priority, then order key (none last), then due time, then id. */
const claimOrder = (a: JobRecord, b: JobRecord): number =>
  b.priority - a.priority ||
  byOrderKey(a.orderKey, b.orderKey) ||
  a.nextRunAt - b.nextRunAt ||
  a.id.localeCompare(b.id);

/** A record as a snapshot from an older version holds it: fields added since may be missing. */
export type StoredJobRecord = Omit<JobRecord, 'interruptions' | 'orderKey'> &
  Partial<Pick<JobRecord, 'interruptions' | 'orderKey'>>;

/** Snapshots from before `interruptions` and `orderKey` existed: never interrupted, no order key. */
const fromStored = (job: StoredJobRecord): JobRecord => ({
  ...job,
  interruptions: job.interruptions ?? 0,
  orderKey: job.orderKey ?? null,
});

export interface MemoryJobStoreOptions {
  readonly clock?: () => number;
  /** Records to start from, e.g. a snapshot written by `onChange` (by this or an older version). */
  readonly initial?: readonly StoredJobRecord[];
  readonly onChange?: (records: readonly JobRecord[]) => void;
}

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<JobId, JobRecord>();
  private readonly clock: () => number;

  constructor(private readonly options: MemoryJobStoreOptions = {}) {
    this.clock = options.clock ?? Date.now;
    for (const job of options.initial ?? []) this.jobs.set(job.id, fromStored(job));
  }

  snapshot(): JobRecord[] {
    return [...this.jobs.values()];
  }

  enqueue(input: JobEnqueueInput): Result<{ job: JobRecord; created: boolean }> {
    if (!input.kind) return err(ValidationError({ field: 'kind' }));
    if (input.payload == null) return err(ValidationError({ field: 'payload' }));
    if (input.idempotencyKey) {
      // Like @taalcut/library: only a live job holds its key; a failed or cancelled one doesn't block a new job.
      const existing = [...this.jobs.values()].find(
        (j) => j.idempotencyKey === input.idempotencyKey && LIVE.includes(j.state),
      );
      if (existing) return ok({ job: existing, created: false });
    }
    const now = this.clock();
    const job: JobRecord = {
      id: input.id ?? newId<'Job'>(),
      kind: input.kind,
      state: 'queued',
      priority: input.priority ?? 0,
      resourceClass: input.resourceClass,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      nextRunAt: input.runAt ?? now,
      idempotencyKey: input.idempotencyKey ?? null,
      progress: null,
      progressDetail: null,
      payload: input.payload,
      result: null,
      error: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      interruptions: 0,
      projectId: input.projectId ?? null,
      orderKey: input.orderKey ?? null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    };
    return ok({ job: this.put(job), created: true });
  }

  get(id: JobId): Result<JobRecord> {
    const job = this.jobs.get(id);
    return job ? ok(job) : err(NotFoundError({ entity: 'job', id }));
  }

  claimNext(claim: JobClaim): Result<JobRecord | null> {
    const now = this.clock();
    const due = [...this.jobs.values()]
      .filter(
        (j) =>
          j.state === 'queued' &&
          j.nextRunAt <= now &&
          (!claim.resourceClass || j.resourceClass === claim.resourceClass) &&
          (!claim.kinds || claim.kinds.includes(j.kind)) &&
          (!claim.ids || claim.ids.includes(j.id)),
      )
      .sort(claimOrder);
    const next = due[0];
    if (!next) return ok(null);
    return ok(
      this.update(next, {
        state: 'running',
        attempts: next.attempts + 1,
        leaseOwner: claim.owner,
        leaseExpiresAt: now + claim.leaseMs,
        startedAt: next.startedAt ?? now,
      }),
    );
  }

  heartbeat(
    id: JobId,
    owner: string,
    update: { leaseMs: number; progress?: number | null; progressDetail?: unknown },
  ): Result<JobRecord> {
    const held = this.held(id, owner);
    if (!held.ok) return held;
    const changes: Partial<JobRecord> = { leaseExpiresAt: this.clock() + update.leaseMs };
    if (update.progress !== undefined) (changes as { progress: number | null }).progress = update.progress;
    if (update.progressDetail !== undefined)
      (changes as { progressDetail: unknown }).progressDetail = update.progressDetail;
    return ok(this.update(held.value, changes));
  }

  complete(id: JobId, owner: string, result?: unknown): Result<JobRecord> {
    const held = this.held(id, owner);
    if (!held.ok) return held;
    return ok(
      this.update(held.value, {
        state: 'succeeded',
        result: result ?? null,
        error: null,
        progress: 1,
        leaseOwner: null,
        leaseExpiresAt: null,
        finishedAt: this.clock(),
      }),
    );
  }

  fail(
    id: JobId,
    owner: string,
    error: unknown,
    options: { retryAt?: number; interruption?: { readonly free: number } } = {},
  ): Result<JobRecord> {
    const held = this.held(id, owner);
    if (!held.ok) return held;
    const job = held.value;
    const interruptions = job.interruptions + (options.interruption ? 1 : 0);
    const released = { leaseOwner: null, leaseExpiresAt: null, error: error ?? null, interruptions };
    if (options.interruption && interruptions <= options.interruption.free) {
      // A free interruption: the attempt is given back.
      const attempts = Math.max(0, job.attempts - 1);
      return ok(
        this.update(job, {
          ...released,
          state: 'queued',
          attempts,
          nextRunAt: options.retryAt ?? this.clock(),
        }),
      );
    }
    if (options.retryAt !== undefined && job.attempts < job.maxAttempts) {
      return ok(this.update(job, { ...released, state: 'queued', nextRunAt: options.retryAt }));
    }
    return ok(this.update(job, { ...released, state: 'failed', finishedAt: this.clock() }));
  }

  release(id: JobId, owner: string): Result<JobRecord> {
    const held = this.held(id, owner);
    if (!held.ok) return held;
    const job = held.value;
    return ok(
      this.update(job, {
        state: 'queued',
        attempts: Math.max(0, job.attempts - 1),
        nextRunAt: this.clock(),
        leaseOwner: null,
        leaseExpiresAt: null,
      }),
    );
  }

  pause(id: JobId): Result<JobRecord> {
    return this.transition(id, (job) => {
      if (job.state === 'queued') return { state: 'paused' };
      if (job.state === 'running') {
        return {
          state: 'paused',
          attempts: Math.max(0, job.attempts - 1),
          leaseOwner: null,
          leaseExpiresAt: null,
        };
      }
      return undefined;
    });
  }

  resume(id: JobId): Result<JobRecord> {
    return this.transition(id, (job) =>
      job.state === 'paused' ? { state: 'queued', nextRunAt: this.clock() } : undefined,
    );
  }

  cancel(id: JobId): Result<JobRecord> {
    return this.transition(id, (job) =>
      FINAL.includes(job.state)
        ? undefined
        : { state: 'cancelled', leaseOwner: null, leaseExpiresAt: null, finishedAt: this.clock() },
    );
  }

  recoverExpiredLeases(): Result<JobRecord[]> {
    const now = this.clock();
    const expired = [...this.jobs.values()].filter(
      (j) => j.state === 'running' && j.leaseExpiresAt !== null && j.leaseExpiresAt <= now,
    );
    return ok(
      expired.map((job) =>
        job.attempts < job.maxAttempts
          ? this.update(job, { state: 'queued', nextRunAt: now, leaseOwner: null, leaseExpiresAt: null })
          : this.update(job, {
              state: 'failed',
              error: {
                code: 'core.process_restarted',
                messageKey: 'errors.core.process_restarted',
                retryable: true,
              },
              leaseOwner: null,
              leaseExpiresAt: null,
              finishedAt: now,
            }),
      ),
    );
  }

  list(options: { states?: readonly JobState[]; kind?: string; limit?: number } = {}): JobRecord[] {
    return [...this.jobs.values()]
      .filter(
        (j) =>
          (!options.states || options.states.includes(j.state)) && (!options.kind || j.kind === options.kind),
      )
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .slice(0, options.limit ?? 500);
  }

  private held(id: JobId, owner: string): Result<JobRecord> {
    const current = this.get(id);
    if (!current.ok) return current;
    const job = current.value;
    return job.state === 'running' && job.leaseOwner === owner
      ? ok(job)
      : err(InvalidJobState({ state: 'lease_lost' }));
  }

  private transition(
    id: JobId,
    change: (job: JobRecord) => Partial<JobRecord> | undefined,
  ): Result<JobRecord> {
    const current = this.get(id);
    if (!current.ok) return current;
    const changes = change(current.value);
    return changes
      ? ok(this.update(current.value, changes))
      : err(InvalidJobState({ state: current.value.state }));
  }

  private update(job: JobRecord, changes: Partial<JobRecord>): JobRecord {
    return this.put({ ...job, ...changes, updatedAt: this.clock() });
  }

  private put(job: JobRecord): JobRecord {
    this.jobs.set(job.id, job);
    this.options.onChange?.(this.snapshot());
    return job;
  }
}
