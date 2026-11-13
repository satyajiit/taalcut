// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The job contract (G7) that P1-E1's durable queue implements: states,
 * resource classes, priorities, progress and the job record. Types and
 * schemas only; the runtime lives in the jobs utility process. See
 * packages/core/SPEC.md, "Job contract".
 */
import '../basics/zod-config';
import { z } from 'zod';
import { publicErrorSchema, taalcutErrorSchema, type PublicError } from '../basics/error-schema';
import type { TaalcutError } from '../basics/errors';
import { idSchema, type JobId, type ProjectId } from '../basics/ids';

export const JOB_STATES = ['queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled'] as const;
export type JobState = (typeof JOB_STATES)[number];

export const TERMINAL_JOB_STATES: readonly JobState[] = ['succeeded', 'failed', 'cancelled'];

/**
 * Which concurrency pool a job runs in. 'video' is the hardware video engine (VideoToolbox, NVENC, QSV,
 * AMF, VA-API); 'gpu' is shader and compute work (Metal, WebGPU, Vulkan); 'npu' is the Neural Engine
 * (Core ML, Apple Vision). They are separate hardware, so one doesn't queue behind another. Limits per
 * class are the queue's policy (lowered on battery and heat); defaults video 2, gpu 1, npu 1.
 */
export const RESOURCE_CLASSES = ['cpu', 'gpu', 'npu', 'video', 'io', 'network'] as const;
export type ResourceClass = (typeof RESOURCE_CLASSES)[number];

/** high: someone is waiting (a probe behind a card). normal: user-started work. low: background indexing. */
export const JOB_PRIORITIES = ['low', 'normal', 'high'] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

const ALLOWED: Record<JobState, readonly JobState[]> = {
  queued: ['running', 'paused', 'cancelled'],
  // Back to queued: waiting for a retry, or recovered after a crash.
  running: ['succeeded', 'failed', 'queued', 'paused', 'cancelled'],
  paused: ['queued', 'cancelled'],
  succeeded: [],
  // A user-initiated retry re-queues a failed job with a fresh attempt budget.
  failed: ['queued'],
  cancelled: [],
};

export function canTransitionJob(from: JobState, to: JobState): boolean {
  return ALLOWED[from].includes(to);
}

export function isTerminalJobState(state: JobState): boolean {
  return TERMINAL_JOB_STATES.includes(state);
}

export const PROGRESS_UNITS = ['frames', 'bytes', 'items', 'ms'] as const;

export interface JobProgress {
  /** 0 to 1, or null when the job can't tell (indeterminate spinner). */
  readonly fraction: number | null;
  readonly completed?: number;
  readonly total?: number;
  readonly unit?: (typeof PROGRESS_UNITS)[number];
  /** i18n key for the current stage, e.g. 'jobs.stage.extractingFrames'. */
  readonly stageKey?: string;
  readonly etaMs?: number;
}

export const jobProgressSchema: z.ZodType<JobProgress> = z.object({
  fraction: z.number().min(0).max(1).nullable(),
  completed: z.number().nonnegative().optional(),
  total: z.number().nonnegative().optional(),
  unit: z.enum(PROGRESS_UNITS).optional(),
  stageKey: z.string().optional(),
  etaMs: z.number().nonnegative().optional(),
});

/** '<package>.<camelCase>', e.g. 'media.probe', 'vision.embedShots'. */
export const jobKindSchema = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);

/**
 * Where a job stands among queued jobs of the same priority (round IX,
 * design B): lower first. The indexing pipeline passes each asset's import
 * order, so one file's stages run before the next file's and it becomes
 * searchable while others are still in flight. A safe integer.
 *
 * The queue claims, among jobs that may run now: priority descending, then
 * `orderKey` ascending with jobs without one last, then the time the job
 * became runnable (`coalesce(next run time, createdAt)`) ascending, then id.
 */
export const jobOrderKeySchema = z.int();

/** What a caller asks for. The queue fills in the rest from the kind's definition. */
export interface JobRequest {
  readonly kind: string;
  readonly input: unknown;
  readonly priority?: JobPriority;
  readonly projectId?: ProjectId | null;
  /** Requests with the same key share one job while it is queued, running, paused or succeeded. */
  readonly idempotencyKey?: string;
  readonly parentId?: JobId;
  /** Don't start before this time (epoch ms). */
  readonly notBefore?: number;
  /** Claim order within a priority, lower first (jobOrderKeySchema). Absent: after every job that has one. */
  readonly orderKey?: number;
}

export const jobRequestSchema: z.ZodType<JobRequest> = z.object({
  kind: jobKindSchema,
  input: z.unknown(),
  priority: z.enum(JOB_PRIORITIES).optional(),
  projectId: idSchema<'Project'>().nullable().optional(),
  idempotencyKey: z.string().min(1).max(512).optional(),
  parentId: idSchema<'Job'>().optional(),
  notBefore: z.int().nonnegative().optional(),
  orderKey: jobOrderKeySchema.optional(),
});

/** A job as stored and as shown in the UI. Times are epoch ms. */
export interface JobSnapshot {
  readonly id: JobId;
  readonly kind: string;
  readonly state: JobState;
  readonly priority: JobPriority;
  readonly resource: ResourceClass;
  readonly projectId: ProjectId | null;
  readonly idempotencyKey: string | null;
  readonly parentId: JobId | null;
  /** 1 on the first run; counts up with each retry. */
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly progress: JobProgress | null;
  readonly error: TaalcutError | null;
  /** The output once succeeded, validated by the kind's output schema. */
  readonly output?: unknown;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  /** When a queued retry may start. */
  readonly nextAttemptAt: number | null;
  /**
   * The request's order key (jobOrderKeySchema), null without one. Optional
   * so jobs stored and snapshots made before round IX still read: absent
   * means null.
   */
  readonly orderKey?: number | null;
}

const time = z.int().nonnegative();

const snapshotFields = {
  id: idSchema<'Job'>(),
  kind: jobKindSchema,
  state: z.enum(JOB_STATES),
  priority: z.enum(JOB_PRIORITIES),
  resource: z.enum(RESOURCE_CLASSES),
  projectId: idSchema<'Project'>().nullable(),
  idempotencyKey: z.string().nullable(),
  parentId: idSchema<'Job'>().nullable(),
  attempt: z.int().positive(),
  maxAttempts: z.int().positive(),
  progress: jobProgressSchema.nullable(),
  output: z.unknown().optional(),
  createdAt: time,
  updatedAt: time,
  startedAt: time.nullable(),
  finishedAt: time.nullable(),
  nextAttemptAt: time.nullable(),
  orderKey: jobOrderKeySchema.nullable().optional(),
};

/** A job as the job store keeps it, `error.detail` included. */
export const jobSnapshotSchema: z.ZodType<JobSnapshot> = z.object({
  ...snapshotFields,
  error: taalcutErrorSchema.nullable(),
});

/** A job as a window sees it (jobsContract): the error without its `detail`. */
export type PublicJobSnapshot = Omit<JobSnapshot, 'error'> & { readonly error: PublicError | null };

export const publicJobSnapshotSchema: z.ZodType<PublicJobSnapshot> = z.object({
  ...snapshotFields,
  error: publicErrorSchema.nullable(),
});
