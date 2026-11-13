// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The job engine's public surface. `createJobEngine` in engine.ts implements it. */
import type { JobConcurrencyPlan, JobId, Result } from '@taalcut/core';
import type { JobDefinition } from './definition';
import type { BackoffPolicy, ThrottlePolicy } from './policy';
import type { ProgressValue } from './progress';
import type { JobEnqueueInput, JobEventSink, JobStore, PowerState } from './ports';
import type { ConcurrencyLimits, JobRecord, JobSummary, LaneLimits } from './types';

export interface JobEngineOptions {
  readonly store: JobStore;
  /** This engine instance's id, the owner of every lease it takes. Default `jobs:<pid>:<random uuid>`. */
  readonly bootId?: string;
  /**
   * The only engine on this store (the app's one jobs process). At start, a
   * running job leased by any other boot id was held by an earlier instance
   * that died, so it goes back to the queue at once instead of when the
   * lease expires. Expired leases are still recovered as usual. Default false:
   * several processes may share the store.
   */
  readonly exclusive?: boolean;
  /**
   * How many restarts may interrupt one job without spending its attempt.
   * Past that the interrupted attempt counts, so a job that keeps taking the
   * process down still runs out of attempts. Default 2. The count is the job
   * row's `interruptions`, which the store keeps.
   */
  readonly freeRestarts?: number;
  /** Takeovers. Default console.warn. */
  readonly log?: (message: string) => void;
  /** Class budgets before the power throttle (default DEFAULT_CONCURRENCY); `applyPlan` replaces them. */
  readonly concurrency?: Partial<ConcurrencyLimits>;
  /**
   * How many jobs of each lane (a kind's `lane`, the model it loads) may run at once, inside the class
   * budget. A lane not named runs DEFAULT_LANE_LIMIT (1). `applyPlan` replaces them.
   */
  readonly lanes?: LaneLimits;
  /**
   * Runs after each attempt's outcome is stored and before its slot is offered to the next job, for at
   * most `afterJobMs` (default 250 ms; a rejection is logged). The indexing pipeline feeds what the job
   * unblocked here, so the next claim sees it: with order keys, an asset's next stage takes the slot
   * before the next asset's work does (depth-first). Not called while the engine stops.
   */
  readonly afterJob?: (jobId: JobId) => Promise<void>;
  readonly afterJobMs?: number;
  readonly power?: PowerState;
  readonly throttle?: ThrottlePolicy;
  readonly events?: JobEventSink;
  /** How long a claim lasts without a heartbeat. Default 30 s. */
  readonly leaseMs?: number;
  /** Default leaseMs / 3. */
  readonly heartbeatMs?: number;
  /** How often to look for due jobs (retries, delayed jobs, jobs from other processes). Default 1 s. */
  readonly pollMs?: number;
  /** At most one progress event per job per interval. Default 250 ms. */
  readonly progressIntervalMs?: number;
  readonly backoff?: Partial<BackoffPolicy>;
  /** How long stop() lets running jobs finish before aborting them. Default 10 s. */
  readonly shutdownGraceMs?: number;
  /** Starts with the whole queue paused (e.g. restored from a setting). */
  readonly startPaused?: boolean;
  readonly clock?: () => number;
  readonly random?: () => number;
}

export interface EnqueueOptions {
  readonly id?: JobId;
  readonly priority?: number;
  readonly idempotencyKey?: string;
  /** Not before this time (ms). */
  readonly runAt?: number;
  readonly maxAttempts?: number;
  readonly projectId?: JobEnqueueInput['projectId'];
  /** Claim order within a priority, lower first (core's jobOrderKeySchema); absent: after every job with one. */
  readonly orderKey?: number;
  /**
   * The running job this one is part of (core's JobRunOptions.parentJobId): while that job runs in this engine,
   * this one is claimed at once, outside its class's limit (children.ts). Otherwise it is an ordinary job.
   */
  readonly parentJobId?: JobId;
}

export interface WaitOptions {
  /** Aborting stops the wait with core.cancelled (and see `cancelOnAbort`). */
  readonly signal?: AbortSignal;
  /**
   * Default true: aborting also cancels the job, unless another wait in this
   * engine still follows it (a de-duplicated job can have several callers).
   */
  readonly cancelOnAbort?: boolean;
  /** Progress while the job runs in this engine, throttled like `job.progress` events. */
  readonly onProgress?: (progress: ProgressValue) => void;
}

export interface JobEngine {
  /** Registers the handler for a kind. Throws on a duplicate kind (a bug). */
  register<P, R>(definition: JobDefinition<P, R>): void;
  /** The owner of this engine's leases. */
  readonly bootId: string;
  /** Takes over a dead instance's leases (exclusive), reclaims expired leases, then starts claiming. */
  start(): Promise<void>;
  /** Stops claiming, lets running jobs finish for `graceMs`, then aborts and releases the rest. */
  stop(options?: { graceMs?: number }): Promise<void>;
  /**
   * Validates the payload against the definition's schema and stores the job.
   * Pass the definition itself to enqueue a kind this process doesn't run.
   * Errors: UnknownJobKind, ValidationError, and the store's errors.
   */
  enqueue<P>(
    job: string | JobDefinition<P, unknown>,
    payload: P,
    options?: EnqueueOptions,
  ): Promise<Result<{ job: JobRecord; created: boolean }>>;
  /** Pauses one job; a running one is aborted and keeps its attempt. */
  pause(id: JobId): Promise<Result<JobRecord>>;
  resume(id: JobId): Promise<Result<JobRecord>>;
  cancel(id: JobId): Promise<Result<JobRecord>>;
  /**
   * Resolves with the job once it has succeeded, failed for good or been
   * cancelled, wherever it ran: the store is re-read on this engine's events
   * for the job and every `pollMs`. Errors: the store's (core.not_found),
   * core.cancelled when `signal` aborts.
   */
  wait(id: JobId, options?: WaitOptions): Promise<Result<JobRecord>>;
  /** Stops claiming and hands this engine's running jobs back to the queue. */
  pauseAll(): Promise<void>;
  resumeAll(): void;
  readonly paused: boolean;
  /** Class budgets after the power throttle. */
  limits(): ConcurrencyLimits;
  /** Lane limits as planned; a lane not named runs DEFAULT_LANE_LIMIT at once. */
  laneLimits(): LaneLimits;
  /**
   * Replaces the class budgets and lane limits (the hardware planner's, core's JobConcurrencyPlan); the
   * power throttle still applies on top. Running jobs aren't interrupted: the plan applies to what starts
   * next. Emits `queue.limits_changed` when anything changed.
   */
  applyPlan(plan: JobConcurrencyPlan): void;
  running(): JobSummary[];
  /** Resolves when nothing is running here and nothing is due now. */
  whenIdle(): Promise<void>;
}
