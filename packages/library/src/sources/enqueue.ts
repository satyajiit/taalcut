// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Enqueuing library work from any process (SPEC, "Where it runs"): a jobs
 * row inserted in the same transaction as the change that needs it, an
 * outbox. The jobs engine polls the table (every `pollMs`, 1 s by default), so
 * it picks up rows other processes wrote. `library.addSource` commits the
 * Source row, its audit entry and its scan job together: a crash can't leave
 * a source that is never scanned.
 */
import {
  err,
  newId,
  ok,
  ValidationError,
  type JobId,
  type JobKind,
  type JobPriority,
  type ProjectId,
  type Result,
} from '@taalcut/core';
import { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import { createJobRepository, type Job } from '../repositories/jobs';
import { priorityValue, scanKey, scanSourceJob, type ScanSourceInput } from './job-kinds';

export interface EnqueueRequest<I> {
  readonly kind: JobKind<I, unknown>;
  readonly input: NoInfer<I>;
  /** Default: the kind's priority. */
  readonly priority?: JobPriority;
  /** Default: the kind's `idempotencyKey(input)`, if any. A live job with the key is returned instead. */
  readonly idempotencyKey?: string;
  readonly id?: JobId;
  readonly projectId?: ProjectId | null;
}

/**
 * Inserts the job row now, inside the caller's transaction when there is one (repository writes join it
 * as a savepoint). Validates the input against the kind, as the engine would.
 */
export function enqueueInTransaction<I>(
  db: LibraryDatabase,
  request: EnqueueRequest<I>,
): Result<{ job: Job; created: boolean }> {
  const parsed = request.kind.input.safeParse(request.input);
  if (!parsed.success) {
    return err(ValidationError({ field: 'input' }, { detail: z.prettifyError(parsed.error) }));
  }
  const key = request.idempotencyKey ?? request.kind.idempotencyKey?.(parsed.data);
  return createJobRepository(db).enqueue({
    id: request.id ?? newId<'Job'>(),
    kind: request.kind.kind,
    payload: parsed.data,
    resourceClass: request.kind.resource,
    priority: priorityValue(request.priority ?? request.kind.priority),
    maxAttempts: request.kind.retry.maxAttempts,
    ...(key !== undefined ? { idempotencyKey: key } : {}),
    ...(request.projectId !== undefined ? { projectId: request.projectId } : {}),
  });
}

/**
 * A scan of a source. Its key is `scan:<sourceId>:<mode>:<hash of paths>@<jobId>`: a queued (or paused)
 * scan with the same base is reused, while a running or finished one doesn't block a new scan, since
 * the disk may have changed behind it.
 */
export function enqueueScan(
  db: LibraryDatabase,
  input: ScanSourceInput,
  options: { readonly id?: JobId; readonly priority?: JobPriority } = {},
): Result<{ job: Job; created: boolean }> {
  const base = scanKey(input);
  const waiting = db.driver
    .prepare(
      `SELECT id FROM jobs WHERE kind = ? AND state IN ('queued', 'paused')
         AND substr(idempotency_key, 1, ?) = ? ORDER BY created_at LIMIT 1`,
    )
    .get(scanSourceJob.kind, base.length + 1, `${base}@`);
  if (waiting) {
    const job = createJobRepository(db).get(String(waiting.id) as JobId);
    if (job.ok) return ok({ job: job.value, created: false });
  }
  const id = options.id ?? newId<'Job'>();
  return enqueueInTransaction(db, {
    kind: scanSourceJob,
    input,
    id,
    idempotencyKey: `${base}@${id}`,
    ...(options.priority ? { priority: options.priority } : {}),
  });
}
