// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The job queue port and its IPC contract. P1-E1 implements the queue in the
 * jobs utility process (SQLite-backed); tools and commands enqueue through
 * JobQueueToken, and the renderer watches and controls jobs through
 * jobsContract. Progress travels as job.progress events, not through this API.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type JobId, type ProjectId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import { implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import {
  JOB_STATES,
  jobKindSchema,
  publicJobSnapshotSchema,
  type JobRequest,
  type JobSnapshot,
  type JobState,
} from './job-types';

export interface JobFilter {
  readonly projectId?: ProjectId | null;
  readonly states?: readonly JobState[];
  readonly kind?: string;
  /** Newest first. Default 100. */
  readonly limit?: number;
}

export interface JobQueue {
  /**
   * Adds a job, validated against its kind's input schema. With an idempotency
   * key that matches a queued, running, paused or succeeded job, returns that
   * job instead of adding another; a failed or cancelled one doesn't count.
   */
  enqueue(request: JobRequest): AsyncResult<JobSnapshot>;
  get(id: JobId): AsyncResult<JobSnapshot>;
  list(filter?: JobFilter): AsyncResult<readonly JobSnapshot[]>;
  /** Stops a running job at its next check of the signal and keeps it for later. */
  pause(id: JobId): AsyncResult<JobSnapshot>;
  resume(id: JobId): AsyncResult<JobSnapshot>;
  cancel(id: JobId): AsyncResult<JobSnapshot>;
  /** Re-queues a failed job with a fresh attempt budget. */
  retry(id: JobId): AsyncResult<JobSnapshot>;
}

export const JobQueueToken = createToken<JobQueue>('core.jobQueue');

const jobId = z.object({ id: idSchema<'Job'>() });

export const jobFilterSchema: z.ZodType<JobFilter> = z.object({
  projectId: idSchema<'Project'>().nullable().optional(),
  states: z.array(z.enum(JOB_STATES)).optional(),
  kind: jobKindSchema.optional(),
  limit: z.int().min(1).max(1000).optional(),
});

/**
 * What the renderer may do with jobs. It can't enqueue arbitrary kinds: jobs
 * start from commands and tools, which decide what work is allowed. A job's
 * error comes without its `detail` (publicJobSnapshotSchema).
 */
export const jobsContract = {
  get: ipc.input(jobId).output(publicJobSnapshotSchema),
  list: ipc.input(jobFilterSchema.optional()).output(z.array(publicJobSnapshotSchema)),
  pause: ipc.input(jobId).output(publicJobSnapshotSchema),
  resume: ipc.input(jobId).output(publicJobSnapshotSchema),
  cancel: ipc.input(jobId).output(publicJobSnapshotSchema),
  retry: ipc.input(jobId).output(publicJobSnapshotSchema),
};

/** Serves jobsContract from the jobs process's JobQueue. */
export function jobsRouter(queue: JobQueue) {
  const os = implementContract(jobsContract);
  const byId =
    (call: (id: JobId) => AsyncResult<JobSnapshot>) =>
    async ({ input }: { input: { id: JobId } }) =>
      unwrapRpc(await call(input.id));
  return os.router({
    get: os.get.handler(byId((id) => queue.get(id))),
    list: os.list.handler(async ({ input }) => [...unwrapRpc(await queue.list(input))]),
    pause: os.pause.handler(byId((id) => queue.pause(id))),
    resume: os.resume.handler(byId((id) => queue.resume(id))),
    cancel: os.cancel.handler(byId((id) => queue.cancel(id))),
    retry: os.retry.handler(byId((id) => queue.retry(id))),
  });
}
