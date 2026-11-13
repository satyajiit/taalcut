// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's job contract on this engine. Domain packages declare kinds with
 * core's `defineJobKind` and handlers typed `JobHandler<I, O>` (core), and
 * never import this package. The jobs process registers them with
 * `fromJobKind`; callers in this process run them with
 * `createEngineJobRunner`.
 */
import {
  CancelledError,
  err,
  isTaalcutError,
  jobProgressSchema,
  ok,
  toTaalcutError,
  type AsyncResult,
  type JobHandler as CoreJobHandler,
  type JobKind,
  type JobPriority,
  type JobProgress,
  type JobRunner,
  type JobRunOptions,
} from '@taalcut/core';
import type { JobEngine } from './api';
import { defineJob, type JobDefinition } from './definition';
import { JobOutputInvalid, UnknownJobKind } from './errors';
import type { ProgressValue } from './progress';
import type { JobRecord } from './types';

/** Core's priority classes as the engine's numbers (higher runs first). */
export const PRIORITY_VALUES: Readonly<Record<JobPriority, number>> = { low: -10, normal: 0, high: 10 };

/**
 * The engine definition for a core job kind and its handler:
 * - `resource` → `resourceClass` (the class budget) and `lane` → `lane` (the model's own limit inside it);
 * - `priority` → `PRIORITY_VALUES`; `retry` → `maxAttempts` and the retry delay (core's `retryDelay`);
 * - `timeoutMs` as is; `idempotencyKey(input)` when `enqueue` gets no key;
 * - `input` validates the payload at enqueue and before each attempt; `output` validates the
 *   result (after a JSON round trip), and a result that fails fails the job with `jobs.output_invalid`;
 * - the handler gets core's `JobContext`; its `progress(JobProgress)` becomes
 *   `report(fraction, JobProgress)`, so `job.progress` events carry the whole value as `detail`.
 *
 * `resumable: false` is not enforced yet: crash recovery requeues every kind with attempts left.
 */
export function fromJobKind<I, O>(kind: JobKind<I, O>, handler: CoreJobHandler<I, O>): JobDefinition<I, O> {
  return defineJob({
    kind: kind.kind,
    resourceClass: kind.resource,
    ...(kind.lane !== undefined ? { lane: kind.lane } : {}),
    payload: kind.input,
    result: kind.output,
    priority: PRIORITY_VALUES[kind.priority],
    maxAttempts: kind.retry.maxAttempts,
    retryPolicy: kind.retry,
    ...(kind.timeoutMs !== undefined ? { timeoutMs: kind.timeoutMs } : {}),
    ...(kind.idempotencyKey ? { idempotencyKey: kind.idempotencyKey } : {}),
    handler: (payload, signal, progress, context) =>
      handler(payload, {
        jobId: context.jobId,
        projectId: context.projectId,
        attempt: context.attempt,
        signal,
        progress: (value) => progress.report(value.fraction, value),
      }),
  });
}

/** Core's runner port, which this engine implements (`createEngineJobRunner`). */
export type { JobRunner, JobRunOptions };

/** Metadata only: `enqueue` reads it, and claims run the handler registered for the kind. */
function enqueueOnly<I, O>(kind: JobKind<I, O>): JobDefinition<I, O> {
  return fromJobKind(kind, async () => err(UnknownJobKind({ kind: kind.kind }, { detail: 'enqueue-only' })));
}

/** `detail` is the JobProgress a `fromJobKind` handler reported; anything else keeps just the fraction. */
function toJobProgress(value: ProgressValue): JobProgress {
  const parsed = jobProgressSchema.safeParse(value.detail);
  return parsed.success ? parsed.data : { fraction: value.fraction };
}

function outcome<I, O>(kind: JobKind<I, O>, job: JobRecord): Awaited<AsyncResult<O>> {
  if (job.state === 'cancelled')
    return err(CancelledError(undefined, { detail: `job ${job.id} was cancelled` }));
  if (job.state === 'failed') return err(isTaalcutError(job.error) ? job.error : toTaalcutError(job.error));
  const output = kind.output.safeParse(job.result);
  if (output.success) return ok(output.data);
  return err(JobOutputInvalid({ kind: kind.kind }, { detail: `stored result: ${output.error.message}` }));
}

/**
 * A JobRunner over an engine: enqueues (with the kind's idempotency key and
 * priority), follows the job's progress, and returns its validated output or
 * its error. The handler runs wherever the kind is registered: this engine,
 * or another process sharing the store (progress then arrives only as bus
 * events, not through `onProgress`).
 */
export function createEngineJobRunner(engine: Pick<JobEngine, 'enqueue' | 'wait'>): JobRunner {
  return {
    async run<I, O>(kind: JobKind<I, O>, input: NoInfer<I>, options: JobRunOptions = {}): AsyncResult<O> {
      const { signal, onProgress } = options;
      if (signal?.aborted) return err(CancelledError());
      const enqueued = await engine.enqueue(enqueueOnly(kind), input, {
        ...(options.priority ? { priority: PRIORITY_VALUES[options.priority] } : {}),
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
        ...(options.parentJobId ? { parentJobId: options.parentJobId } : {}),
      });
      if (!enqueued.ok) return enqueued;
      options.onEnqueued?.(enqueued.value.job.id);
      const finished = await engine.wait(enqueued.value.job.id, {
        ...(signal ? { signal } : {}),
        ...(onProgress ? { onProgress: (value: ProgressValue) => onProgress(toJobProgress(value)) } : {}),
      });
      return finished.ok ? outcome(kind, finished.value) : finished;
    },
  };
}
