// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Job definitions: what a domain package registers for each job kind. */
import {
  jobKindSchema,
  jobLaneSchema,
  type JobId,
  type JobLane,
  type ProjectId,
  type Result,
  type RetryPolicy,
} from '@taalcut/core';
import type { ZodType } from 'zod';
import type { BackoffPolicy } from './policy';
import type { ProgressReporter, ProgressValue } from './progress';
import type { ResourceClass } from './types';

export interface JobContext {
  readonly jobId: JobId;
  readonly kind: string;
  /** 1 on the first attempt. */
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly projectId: ProjectId | null;
  /**
   * The last progress saved before this attempt (by a heartbeat of an earlier,
   * interrupted attempt), so a handler can continue instead of starting over.
   * Null on a fresh job.
   */
  readonly resumeFrom: ProgressValue | null;
}

/**
 * A job handler: an async function of its payload. It must stop soon after
 * `signal` aborts (pause, cancel, timeout, shutdown). It may return a value or
 * a core Result; it may throw. A thrown or returned TaalcutError is retried if
 * `retryable`; anything else thrown is retried as `jobs.handler_failed`. The
 * result must be JSON-serialisable: it is stored.
 */
export type JobHandler<P, R> = (
  payload: P,
  signal: AbortSignal,
  progress: ProgressReporter,
  context: JobContext,
) => Promise<R | Result<R>>;

export interface JobDefinition<P = unknown, R = unknown> {
  /** e.g. 'media.probe', 'media.extractFrame'. See `isValidJobKind`. */
  readonly kind: string;
  /** The hardware class; its budget is shared by every lane of the class. */
  readonly resourceClass: ResourceClass;
  /**
   * The model or process the kind's jobs share (core's `JobKind.lane`, e.g. 'vision.embedder'): at most
   * the lane's limit of them run at once, inside the class budget. Absent: only the class budget applies.
   */
  readonly lane?: JobLane;
  /** Validates the payload at enqueue and again before each attempt (stored data is untrusted). */
  readonly payload?: ZodType<P>;
  /**
   * Validates the handler's result, after a JSON round trip (it is stored as
   * JSON). A result that fails fails the job with `jobs.output_invalid`, not
   * retried: the handler would produce it again.
   */
  readonly result?: ZodType<R>;
  readonly handler: JobHandler<P, R>;
  /** Default priority when enqueuing; higher runs first. Default 0. */
  readonly priority?: number;
  /** Default 3. */
  readonly maxAttempts?: number;
  /** Merged over the engine's backoff. Ignored when `retryPolicy` is set. */
  readonly backoff?: Partial<BackoffPolicy>;
  /** Core's retry policy (from a JobKind): its backoff decides the delay; `maxAttempts` should match. */
  readonly retryPolicy?: RetryPolicy;
  /** Per attempt; the signal aborts and the attempt fails with core.timeout (retryable). */
  readonly timeoutMs?: number;
  /** The idempotency key when `enqueue` is given none, e.g. a content hash of the payload. */
  readonly idempotencyKey?: (payload: P) => string;
}

/** The engine's original kinds: lower-case words separated by '.', '_' or '-'. */
const LEGACY_KIND = /^[a-z][a-z0-9]*([._-][a-z0-9]+)*$/;

/**
 * True for core's `<package>.<camelCase>` kinds (`jobKindSchema`, e.g.
 * 'media.extractFrame') and for the engine's lower-case kinds
 * ('components.install'). Nothing else: no capitals at the start of a
 * segment, no spaces, no empty segments.
 */
export function isValidJobKind(kind: string): boolean {
  return jobKindSchema.safeParse(kind).success || LEGACY_KIND.test(kind);
}

/** Identity function that keeps the payload and result types. */
export function defineJob<P, R>(definition: JobDefinition<P, R>): JobDefinition<P, R> {
  if (!isValidJobKind(definition.kind)) throw new Error(`Invalid job kind '${definition.kind}'`);
  if (definition.lane !== undefined && !jobLaneSchema.safeParse(definition.lane).success)
    throw new Error(`Job kind '${definition.kind}' names an invalid lane '${definition.lane}'`);
  return definition;
}

/** True for a core Result object. */
export function isResult(value: unknown): value is Result<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { ok?: unknown };
  return typeof v.ok === 'boolean' && ('value' in value || 'error' in value);
}
