// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the job engine (@taalcut/jobs) keeps its jobs. library implements it
 * on the Job table; it lives in core because library may import only core.
 */
import '../basics/zod-config';
import { z } from 'zod';
import type { JobId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { JobFilter } from './job-queue';
import { jobSnapshotSchema, type JobSnapshot, type JobState } from './job-types';

/** A job as stored: the snapshot plus its validated input (JSON). */
export interface JobRecord extends JobSnapshot {
  readonly input: unknown;
}

export const jobRecordSchema: z.ZodType<JobRecord> = z.intersection(
  jobSnapshotSchema,
  z.object({ input: z.unknown() }),
);

export interface JobStore {
  /**
   * Inserts a job. If its idempotencyKey matches a queued, running, paused or
   * succeeded job, returns that job with created: false and inserts nothing.
   * The check and the insert are one transaction.
   */
  insert(job: JobRecord): AsyncResult<{ readonly job: JobRecord; readonly created: boolean }>;
  /**
   * Replaces a job if its stored state is still `expectedState` (optimistic
   * check); otherwise core.conflict and nothing changes. Unknown ids are
   * core.not_found.
   */
  update(job: JobRecord, expectedState: JobState): AsyncResult<JobRecord>;
  get(id: JobId): AsyncResult<JobRecord>;
  /** Newest first. The engine lists 'running' jobs on start to recover them. */
  list(filter?: JobFilter): AsyncResult<readonly JobRecord[]>;
}

export const JobStoreToken = createToken<JobStore>('core.jobStore');
