// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's JobStore port (packages/core/SPEC.md section 10, "Jobs") on the jobs
 * table: whole-record inserts and optimistic updates. The lease-based
 * repository in repositories/jobs.ts works on the same rows.
 *
 * Mapping: priority high/normal/low ↔ 10/0/−10 (JOB_PRIORITY_VALUES; any positive or negative number
 * a lease writer stored reads as high or low); `attempt` ↔ attempts (a job
 * that never ran reads as attempt 1); `progress` ↔ progress (the fraction) and
 * progress_detail (the rest); `input` ↔ payload; `output` ↔ result;
 * `nextAttemptAt` ↔ next_run_at; `orderKey` ↔ order_key (absent for null).
 */
import {
  ConflictError,
  err,
  jobRecordSchema,
  NotFoundError,
  ok,
  ValidationError,
  type JobFilter,
  type JobId,
  type JobPriority,
  type JobProgress,
  type JobRecord,
  type JobStore,
  type Result,
} from '@taalcut/core';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { inTransaction, pageSize } from '../repositories/shared';
import { JOB_PRIORITY_VALUES, jobs, LIVE_JOB_STATES } from '../schema/jobs';

type JobRow = typeof jobs.$inferSelect;

const PRIORITY: Readonly<Record<JobPriority, number>> = JOB_PRIORITY_VALUES;
const priorityOf = (value: number): JobPriority => (value > 0 ? 'high' : value < 0 ? 'low' : 'normal');

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function progressOf(row: JobRow): JobProgress | null {
  if (row.progress === null && row.progressDetail == null) return null;
  return { ...(isObject(row.progressDetail) ? row.progressDetail : {}), fraction: row.progress };
}

function validate(value: unknown): Result<JobRecord> {
  const parsed = jobRecordSchema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  const field = parsed.error.issues[0]?.path.map(String).join('.') || undefined;
  return err(ValidationError(field ? { field } : undefined, { detail: parsed.error.message }));
}

/** A stored row as core's JobRecord, validated. */
export function toJobRecord(row: JobRow): Result<JobRecord> {
  return validate({
    id: row.id,
    kind: row.kind,
    state: row.state,
    priority: priorityOf(row.priority),
    resource: row.resourceClass,
    projectId: row.projectId,
    idempotencyKey: row.idempotencyKey,
    parentId: row.parentId,
    attempt: Math.max(1, row.attempts),
    maxAttempts: row.maxAttempts,
    progress: progressOf(row),
    error: row.error ?? null,
    ...(row.result == null ? {} : { output: row.result }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    nextAttemptAt: row.nextRunAt,
    // Absent means null (core's additive rule), so a job without a key reads as it did before round IX.
    ...(row.orderKey === null ? {} : { orderKey: row.orderKey }),
    input: row.payload,
  });
}

function columns(job: JobRecord) {
  const { fraction, ...detail } = job.progress ?? { fraction: null };
  return {
    kind: job.kind,
    state: job.state,
    priority: PRIORITY[job.priority],
    resourceClass: job.resource,
    attempts: job.attempt,
    maxAttempts: job.maxAttempts,
    nextRunAt: job.nextAttemptAt,
    idempotencyKey: job.idempotencyKey,
    progress: fraction,
    progressDetail: job.progress ? detail : null,
    // JSON null must be the text 'null': SQL NULL would break the NOT NULL column.
    payload: job.input == null ? sql`'null'` : job.input,
    result: job.output ?? null,
    error: job.error,
    projectId: job.projectId,
    parentId: job.parentId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    // A record from before round IX has none: null, a job without a key.
    orderKey: job.orderKey ?? null,
    // Core's records carry no lease; a job leaving 'running' through this port loses any lease it had.
    ...(job.state === 'running' ? {} : { leaseOwner: null, leaseExpiresAt: null }),
  };
}

/** Core's JobStore over the jobs table. */
export function createJobStore(db: LibraryDatabase): JobStore {
  const { orm } = db;
  const row = (id: JobId) => orm.select().from(jobs).where(eq(jobs.id, id)).get();

  function insert(input: JobRecord): Result<{ job: JobRecord; created: boolean }> {
    const job = validate(input);
    if (!job.ok) return job;
    return inTransaction<{ job: JobRecord; created: boolean }>(db, 'job', () => {
      if (job.value.idempotencyKey !== null) {
        const live = orm
          .select()
          .from(jobs)
          .where(
            and(eq(jobs.idempotencyKey, job.value.idempotencyKey), inArray(jobs.state, [...LIVE_JOB_STATES])),
          )
          .get();
        if (live) {
          const existing = toJobRecord(live);
          return existing.ok ? ok({ job: existing.value, created: false }) : existing;
        }
      }
      const inserted = orm
        .insert(jobs)
        .values({ id: job.value.id, ...columns(job.value) })
        .returning()
        .get();
      const stored = toJobRecord(inserted);
      return stored.ok ? ok({ job: stored.value, created: true }) : stored;
    });
  }

  function update(input: JobRecord, expectedState: JobRecord['state']): Result<JobRecord> {
    const job = validate(input);
    if (!job.ok) return job;
    return inTransaction(db, 'job', () => {
      const current = row(job.value.id);
      if (!current) return err(NotFoundError({ entity: 'job', id: job.value.id }));
      if (current.state !== expectedState) {
        return err(
          ConflictError(
            { entity: 'job', id: job.value.id },
            { detail: `expected ${expectedState}, is ${current.state}` },
          ),
        );
      }
      const updated = orm
        .update(jobs)
        .set(columns(job.value))
        .where(eq(jobs.id, job.value.id))
        .returning()
        .get()!;
      return toJobRecord(updated);
    });
  }

  function list(filter: JobFilter = {}): Result<JobRecord[]> {
    const project =
      filter.projectId === undefined
        ? undefined
        : filter.projectId === null
          ? isNull(jobs.projectId)
          : eq(jobs.projectId, filter.projectId);
    const rows = orm
      .select()
      .from(jobs)
      .where(
        and(
          project,
          filter.states ? inArray(jobs.state, [...filter.states]) : undefined,
          filter.kind ? eq(jobs.kind, filter.kind) : undefined,
        ),
      )
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(pageSize(filter.limit, 100, 1000))
      .all();
    const records: JobRecord[] = [];
    for (const r of rows) {
      const record = toJobRecord(r);
      if (!record.ok) return record;
      records.push(record.value);
    }
    return ok(records);
  }

  return {
    insert: async (job) => insert(job),
    update: async (job, expectedState) => update(job, expectedState),
    get: async (id) => {
      const found = row(id);
      return found ? toJobRecord(found) : err(NotFoundError({ entity: 'job', id }));
    },
    list: async (filter) => list(filter),
  };
}
