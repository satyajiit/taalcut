// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The engine's job contract: the stored job record and the events the engine
 * emits. States and resource classes are core's (re-exported here); the
 * record is lease-based, which core's JobSnapshot is not.
 */
import type { JobId, JobLane, JobState, ProjectId, ResourceClass, TaalcutError } from '@taalcut/core';

export {
  JOB_STATES,
  RESOURCE_CLASSES,
  TERMINAL_JOB_STATES as TERMINAL_STATES,
  type JobState,
  type ResourceClass,
} from '@taalcut/core';

/**
 * Budgets per resource class: core's RESOURCE_CLASSES. 'video' is the hardware video engine
 * (VideoToolbox), 'gpu' shader and compute work (Metal, WebGPU), 'npu' the Neural Engine (Core ML, Vision).
 * A class's budget is shared by all its lanes and its jobs without a lane.
 */
export type ConcurrencyLimits = Readonly<Record<ResourceClass, number>>;

/** Per lane: how many of its jobs may run at once (core's JobConcurrencyPlan.lanes); absent: DEFAULT_LANE_LIMIT. */
export type LaneLimits = Readonly<Partial<Record<JobLane, number>>>;

/** A stored job, as the JobStore returns it. @taalcut/library's Job row has exactly this shape. */
export interface JobRecord {
  readonly id: JobId;
  readonly kind: string;
  readonly state: JobState;
  /** Higher runs first. */
  readonly priority: number;
  readonly resourceClass: ResourceClass;
  /** Attempts started so far, including the running one. */
  readonly attempts: number;
  readonly maxAttempts: number;
  /** Not claimed before this time (ms). */
  readonly nextRunAt: number;
  readonly idempotencyKey: string | null;
  /** 0..1, null when unknown. Saved on heartbeats, so a resumed job can continue from it. */
  readonly progress: number | null;
  readonly progressDetail: unknown;
  readonly payload: unknown;
  readonly result: unknown;
  readonly error: unknown;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: number | null;
  /**
   * How many of this job's attempts a restart of the jobs process has cut short (an exclusive engine took
   * its lease over from a dead boot). Kept in the store, so it survives the restarts it counts.
   */
  readonly interruptions: number;
  readonly projectId: ProjectId | null;
  /**
   * Claim order within a priority, lower first, null after every job with one (core's jobOrderKeySchema).
   * The indexing pipeline passes each asset's import order, so indexing goes depth-first by asset.
   */
  readonly orderKey: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
}

/** What events carry about a job: small and serialisable, never the payload or result. */
export interface JobSummary {
  readonly id: JobId;
  readonly kind: string;
  readonly state: JobState;
  readonly priority: number;
  readonly resourceClass: ResourceClass;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly projectId: ProjectId | null;
}

export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical';

export interface PowerSnapshot {
  readonly onBattery: boolean;
  readonly thermalState: ThermalState;
}

/** How an exclusive engine took a job over from an earlier, dead instance of its process. */
export interface Takeover {
  /** The dead instance's boot id, which still held the lease. */
  readonly previousOwner: string;
  /** How many attempts at this job restarts have interrupted, this one included (the row's `interruptions`). */
  readonly restarts: number;
  /** False: the attempt was given back. True: past the free restarts, it counts like a failure. */
  readonly attemptCounted: boolean;
}

/** Why the engine handed a running job back to the queue without spending the attempt. */
export type ReleaseReason = 'shutdown' | 'queue_paused';

export type JobEvent =
  | { readonly type: 'job.enqueued'; readonly job: JobSummary }
  | { readonly type: 'job.started'; readonly job: JobSummary }
  | {
      readonly type: 'job.progress';
      readonly jobId: JobId;
      readonly kind: string;
      readonly fraction: number | null;
      readonly detail?: unknown;
    }
  | { readonly type: 'job.succeeded'; readonly job: JobSummary }
  | {
      readonly type: 'job.failed';
      readonly job: JobSummary;
      readonly error: TaalcutError;
      readonly willRetry: boolean;
      readonly retryAt: number | null;
    }
  | { readonly type: 'job.paused'; readonly job: JobSummary }
  | { readonly type: 'job.resumed'; readonly job: JobSummary }
  | { readonly type: 'job.cancelled'; readonly job: JobSummary }
  | { readonly type: 'job.released'; readonly job: JobSummary; readonly reason: ReleaseReason }
  /**
   * A crashed worker's job was taken back (requeued, or failed if out of attempts): after its lease
   * expired, or at once by an exclusive engine at start (`takeover`).
   */
  | { readonly type: 'job.recovered'; readonly job: JobSummary; readonly takeover?: Takeover }
  /** This engine lost the job (paused, cancelled or reclaimed elsewhere); its handler was aborted. */
  | { readonly type: 'job.lease_lost'; readonly jobId: JobId; readonly kind: string }
  | { readonly type: 'queue.paused' }
  | { readonly type: 'queue.resumed' }
  | {
      readonly type: 'queue.limits_changed';
      /** Class budgets after the throttle. */
      readonly limits: ConcurrencyLimits;
      /** Lane limits as planned (the throttle lowers class budgets only). */
      readonly lanes: LaneLimits;
      /** Classes that draw on another class's budget (core's JobConcurrencyPlan.foldInto); absent: none. */
      readonly foldInto?: Readonly<Partial<Record<ResourceClass, ResourceClass>>>;
      readonly power: PowerSnapshot;
    }
  /** The store failed in a way the engine can't attribute to one job (e.g. claim failed). */
  | { readonly type: 'queue.store_error'; readonly error: TaalcutError };

export function summarize(job: JobRecord): JobSummary {
  return {
    id: job.id,
    kind: job.kind,
    state: job.state,
    priority: job.priority,
    resourceClass: job.resourceClass,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    projectId: job.projectId,
  };
}
