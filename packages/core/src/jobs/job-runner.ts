// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The JobRunner port: how a tool hands its heavy step to the durable job
 * engine and waits for the result. In the app the agent process gets a
 * runner over IPC (jobRunnerOverRpc: enqueue in the jobs process, follow
 * progress, await the terminal state, cancel on abort); in the jobs process
 * @taalcut/jobs' createEngineJobRunner runs on the engine; tests and
 * single-process hosts use createDirectJobRunner, which runs the same
 * handlers in this process. Moved here from @taalcut/media (jobs/runner.ts).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { CancelledError, NotFoundError, ValidationError } from '../basics/errors';
import { newId, type JobId, type ProjectId } from '../basics/ids';
import { err, ok, type AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { JobContext, JobHandler, JobKind } from './job-kind';
import type { JobPriority, JobProgress } from './job-types';

export interface JobRunOptions {
  /** Aborting cancels the job (unless another caller still waits for it); the result is core.cancelled. */
  readonly signal?: AbortSignal;
  /** The job's progress as the engine publishes it (throttled). */
  readonly onProgress?: (progress: JobProgress) => void;
  /** Default: the kind's priority. */
  readonly priority?: JobPriority;
  /** Default: the kind's `idempotencyKey(input)`, if it has one. */
  readonly idempotencyKey?: string;
  readonly projectId?: ProjectId | null;
  /**
   * Called once with the job's id when it is enqueued, or matched to an existing job by its key, before it
   * runs: a card can follow or cancel the job while the caller waits.
   */
  readonly onEnqueued?: (jobId: JobId) => void;
  /**
   * The running job this one is part of (round P3-3): an export that bakes a grade LUT or tracks a subject
   * while it holds its resource slot. The parent waits for the child, so the queue must start the child
   * without a free slot of its class; queued behind its own parent it would wait for itself (render.export,
   * vision.bakeGrade and render.trackSubjects are all 'gpu', default limit 1). Absent: an ordinary job.
   */
  readonly parentJobId?: JobId;
}

export interface JobRunner {
  /**
   * Enqueues `input` as a job of `kind`, waits for it to finish, and returns
   * its output (validated by `kind.output`) or its error. With a matching
   * idempotency key the queue may hand back an existing job's result.
   */
  run<I, O>(kind: JobKind<I, O>, input: NoInfer<I>, options?: JobRunOptions): AsyncResult<O>;
}

export const JobRunnerToken = createToken<JobRunner>('core.jobRunner');

/** A job kind and the handler that runs it: what the jobs process registers. */
export interface JobRegistration {
  readonly kind: JobKind<unknown, unknown>;
  readonly handler: JobHandler<unknown, unknown>;
}

/**
 * Pairs a kind with its handler and erases the types for a list. Safe because
 * the engine validates every input with `kind.input` before the handler runs.
 */
export function registerJob<I, O>(kind: JobKind<I, O>, handler: JobHandler<I, O>): JobRegistration {
  return {
    kind: kind as unknown as JobKind<unknown, unknown>,
    handler: (input, context) => handler(input as I, context),
  };
}

/**
 * Turns job progress into a tool's `reportProgress(fraction, note)`: the job's
 * 0..1 maps onto `[from, to]` of the tool's bar, an unknown fraction keeps the
 * last value, and a stage key becomes its note (or is passed through).
 */
export function forwardJobProgress(
  report: (fraction: number, note?: string) => void,
  options: {
    readonly notes?: Readonly<Record<string, string>>;
    readonly from?: number;
    readonly to?: number;
  } = {},
): (progress: JobProgress) => void {
  const { notes = {}, from = 0, to = 1 } = options;
  let last = from;
  return (progress) => {
    if (progress.fraction !== null) last = from + (to - from) * progress.fraction;
    const note =
      progress.stageKey === undefined ? undefined : (notes[progress.stageKey] ?? progress.stageKey);
    report(last, note);
  };
}

/**
 * Runs registered handlers in this process, once each: no queue, retries or
 * timeouts, but the same input and output validation as the engine, and the
 * output goes through JSON first, so whatever wouldn't survive being stored
 * fails here too.
 */
export function createDirectJobRunner(registrations: readonly JobRegistration[]): JobRunner {
  const handlers = new Map(registrations.map((r) => [r.kind.kind, r.handler]));
  return {
    async run<I, O>(kind: JobKind<I, O>, input: NoInfer<I>, options: JobRunOptions = {}): AsyncResult<O> {
      const handler = handlers.get(kind.kind);
      if (!handler) return err(NotFoundError({ entity: 'job kind', id: kind.kind }));
      if (options.signal?.aborted) return err(CancelledError());
      const parsed = kind.input.safeParse(input);
      if (!parsed.success)
        return err(ValidationError({ field: 'input' }, { detail: z.prettifyError(parsed.error) }));
      const context: JobContext = {
        jobId: newId<'Job'>(),
        projectId: options.projectId ?? null,
        attempt: 1,
        signal: options.signal ?? new AbortController().signal,
        progress: (progress) => options.onProgress?.(progress),
      };
      options.onEnqueued?.(context.jobId);
      const result = await handler(parsed.data, context);
      if (!result.ok) return result;
      const stored: unknown = JSON.parse(JSON.stringify(result.value) ?? 'null');
      const output = kind.output.safeParse(stored);
      if (!output.success)
        return err(ValidationError({ field: 'output' }, { detail: z.prettifyError(output.error) }));
      return ok(output.data);
    },
  };
}
