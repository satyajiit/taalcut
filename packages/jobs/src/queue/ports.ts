// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the job engine needs from outside. The desktop composition root passes
 * the implementations in: @taalcut/library's JobStore repository (this
 * package can't import library), a PowerState over Electron's powerMonitor,
 * and core's event bus as the event sink.
 */
import type { JobId, ProjectId, Result } from '@taalcut/core';
import type { JobEvent, JobRecord, JobState, ResourceClass, ThermalState } from './types';

/** Sync or async: @taalcut/library's store is synchronous; a store over IPC would not be. */
export type MaybePromise<T> = T | Promise<T>;

export interface JobEnqueueInput {
  readonly id?: JobId;
  readonly kind: string;
  readonly payload: unknown;
  readonly resourceClass: ResourceClass;
  readonly priority?: number;
  readonly maxAttempts?: number;
  /**
   * Enqueuing a key held by a queued, running, paused or succeeded job returns
   * that job with `created: false`; a failed or cancelled one doesn't block a new job.
   */
  readonly idempotencyKey?: string | null;
  readonly runAt?: number;
  readonly projectId?: ProjectId | null;
  /** Claim order within a priority (JobRecord.orderKey); absent: null. */
  readonly orderKey?: number;
}

export interface JobClaim {
  readonly owner: string;
  readonly leaseMs: number;
  readonly resourceClass?: ResourceClass;
  readonly kinds?: readonly string[];
  /** Only these jobs (a running job's children, claimed outside the limit). */
  readonly ids?: readonly JobId[];
}

/**
 * Durable job storage with atomic state changes. Shaped like
 * @taalcut/library's JobStore, which satisfies it as is. Errors: a retryable
 * error (e.g. database busy) is retried by the engine; any other error from
 * heartbeat/complete/fail/release means this owner no longer holds the job.
 */
export interface JobStore {
  enqueue(input: JobEnqueueInput): MaybePromise<Result<{ job: JobRecord; created: boolean }>>;
  get(id: JobId): MaybePromise<Result<JobRecord>>;
  /**
   * Atomically takes the next due job matching the claim, or null; counts an attempt. Order: priority
   * descending, then `orderKey` ascending with null last, then the time it became due, then id.
   */
  claimNext(claim: JobClaim): MaybePromise<Result<JobRecord | null>>;
  heartbeat(
    id: JobId,
    owner: string,
    update: { leaseMs: number; progress?: number | null; progressDetail?: unknown },
  ): MaybePromise<Result<JobRecord>>;
  complete(id: JobId, owner: string, result?: unknown): MaybePromise<Result<JobRecord>>;
  /**
   * Requeues at `retryAt` if given and attempts remain; otherwise the job fails for good. With
   * `interruption` (a dead boot's lease taken over), first adds one to `interruptions`, in the same atomic
   * change; while that is at most `free` the attempt is given back instead (requeued, attempts - 1).
   */
  fail(
    id: JobId,
    owner: string,
    error: unknown,
    options?: { retryAt?: number; interruption?: { readonly free: number } },
  ): MaybePromise<Result<JobRecord>>;
  /** running → queued, due now, giving the attempt back. */
  release(id: JobId, owner: string): MaybePromise<Result<JobRecord>>;
  pause(id: JobId): MaybePromise<Result<JobRecord>>;
  resume(id: JobId): MaybePromise<Result<JobRecord>>;
  cancel(id: JobId): MaybePromise<Result<JobRecord>>;
  /** Running jobs whose lease expired go back to the queue, or fail when out of attempts. */
  recoverExpiredLeases(): MaybePromise<Result<readonly JobRecord[]>>;
  list(options?: {
    states?: readonly JobState[];
    kind?: string;
    limit?: number;
  }): MaybePromise<readonly JobRecord[]>;
}

/**
 * Power and thermal state. The desktop maps Electron's powerMonitor:
 * `isOnBatteryPower()` and the 'on-battery' / 'on-ac' events for `onBattery`;
 * `getCurrentThermalState()` and 'thermal-state-change' (macOS) for
 * `thermalState`, with Electron's 'unknown' read as 'nominal'.
 */
export interface PowerState {
  readonly onBattery: boolean;
  readonly thermalState: ThermalState;
  /** Calls `listener` after either value changes. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void;
}

/** Where engine events go: core's event bus once it exists (P1-C5). Must not throw; errors are swallowed. */
export interface JobEventSink {
  emit(event: JobEvent): void;
}

/** A PowerState that never changes: on AC power, nominal temperature. */
export const STEADY_POWER: PowerState = {
  onBattery: false,
  thermalState: 'nominal',
  onChange: () => () => undefined,
};
