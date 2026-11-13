// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Job kinds and retry policies. A domain package declares each kind once with
 * defineJobKind and registers a handler for it in the jobs process.
 */
import '../basics/zod-config';
import { z } from 'zod';
import type { TaalcutError } from '../basics/errors';
import type { JobId, ProjectId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { jobLaneSchema, type JobLane } from './job-lanes';
import { jobKindSchema, type JobPriority, type JobProgress, type ResourceClass } from './job-types';

export type Backoff =
  | { readonly kind: 'fixed'; readonly delayMs: number }
  | {
      readonly kind: 'exponential';
      readonly initialMs: number;
      readonly maxMs: number;
      readonly factor: number;
      /** Full jitter: a random delay between 0 and the computed one, so retries don't stampede. */
      readonly jitter: boolean;
    };

export interface RetryPolicy {
  /** Total runs including the first. 1 means never retry. */
  readonly maxAttempts: number;
  readonly backoff: Backoff;
}

export const retryPolicySchema: z.ZodType<RetryPolicy> = z.object({
  maxAttempts: z.int().min(1).max(100),
  backoff: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('fixed'), delayMs: z.int().nonnegative() }),
    z.object({
      kind: z.literal('exponential'),
      initialMs: z.int().positive(),
      maxMs: z.int().positive(),
      factor: z.number().min(1),
      jitter: z.boolean(),
    }),
  ]),
});

export const NO_RETRY: RetryPolicy = { maxAttempts: 1, backoff: { kind: 'fixed', delayMs: 0 } };

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  backoff: { kind: 'exponential', initialMs: 1_000, maxMs: 60_000, factor: 2, jitter: true },
};

/**
 * How long to wait before the next attempt, or null to give up. Only errors
 * marked retryable are retried; `attempt` is the run that just failed (1-based).
 */
export function retryDelay(
  policy: RetryPolicy,
  attempt: number,
  error: TaalcutError,
  random: () => number = Math.random,
): number | null {
  if (!error.retryable || attempt >= policy.maxAttempts) return null;
  const { backoff } = policy;
  if (backoff.kind === 'fixed') return backoff.delayMs;
  const delay = Math.min(backoff.maxMs, backoff.initialMs * backoff.factor ** (attempt - 1));
  return Math.round(backoff.jitter ? random() * delay : delay);
}

/** What a job handler gets besides its input. */
export interface JobContext {
  readonly jobId: JobId;
  readonly projectId: ProjectId | null;
  readonly attempt: number;
  /** Fires on cancel, pause and timeout. Stop promptly and return CancelledError. */
  readonly signal: AbortSignal;
  /** Throttled by the queue before it becomes a job.progress event. */
  progress(progress: JobProgress): void;
}

export type JobHandler<I, O> = (input: I, context: JobContext) => AsyncResult<O>;

export interface JobKind<I = unknown, O = unknown> {
  readonly kind: string;
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  /**
   * The hardware class the job runs on. Its limit is the budget all the
   * class's lanes share, and the limit for the class's jobs without a lane.
   */
  readonly resource: ResourceClass;
  /**
   * The model or process the job shares with other kinds (round IX), e.g.
   * 'vision.embedder', 'audio.whisper'. At most the lane's limit of its jobs
   * run at once (DEFAULT_LANE_LIMIT unless the plan says otherwise), inside
   * the class budget. Absent: only the class budget limits it.
   */
  readonly lane?: JobLane;
  readonly priority: JobPriority;
  readonly retry: RetryPolicy;
  /** Each attempt is aborted after this long and fails with core.timeout (retryable). */
  readonly timeoutMs?: number;
  /**
   * Safe to start again from scratch after a crash (outputs written atomically,
   * or checkpointed in the input). Not resumable means a crash fails the job.
   */
  readonly resumable: boolean;
  /** Derives an idempotency key from the input when the caller doesn't give one, e.g. a content hash. */
  readonly idempotencyKey?: (input: I) => string;
}

export function defineJobKind<I, O>(spec: {
  readonly kind: string;
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  readonly resource: ResourceClass;
  readonly lane?: JobLane;
  readonly priority?: JobPriority;
  readonly retry?: RetryPolicy;
  readonly timeoutMs?: number;
  readonly resumable?: boolean;
  readonly idempotencyKey?: (input: I) => string;
}): JobKind<I, O> {
  if (!jobKindSchema.safeParse(spec.kind).success) {
    throw new Error(`Invalid job kind '${spec.kind}': use '<package>.<camelCase>'.`);
  }
  if (spec.lane !== undefined && !jobLaneSchema.safeParse(spec.lane).success) {
    throw new Error(
      `Job kind '${spec.kind}' names an invalid lane '${spec.lane}': use '<package>.<camelCase>'.`,
    );
  }
  return {
    ...spec,
    priority: spec.priority ?? 'normal',
    retry: spec.retry ?? DEFAULT_RETRY,
    resumable: spec.resumable ?? true,
  };
}
