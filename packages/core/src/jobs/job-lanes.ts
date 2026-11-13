// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Job lanes (round IX, design A). A job kind's `resource` is the hardware
 * class it runs on; its optional `lane` is the model or process its jobs
 * share (one EmbeddingGemma, one whisper server). The class limit is a
 * budget every lane of that class shares, and each lane has its own limit
 * inside it, so the embedder and whisper can run side by side on the GPU
 * while neither runs two jobs at once. The engine (@taalcut/jobs) enforces
 * both; the hardware planner (@taalcut/models) chooses the numbers. See
 * packages/core/SPEC.md, "Job lanes".
 */
import '../basics/zod-config';
import { z } from 'zod';
import { RESOURCE_CLASSES, type ResourceClass } from './job-types';

/**
 * '<package>.<camelCase>', at most 60 characters, the shape of an index
 * stage name: 'vision.embedder', 'audio.whisper', 'audio.parakeet',
 * 'audio.beats', 'models.llm'. Name the model or process, not the job kind,
 * so every kind that loads it shares one lane.
 */
export const jobLaneSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*$/)
  .max(60);
export type JobLane = z.output<typeof jobLaneSchema>;

/** Jobs of one lane at once when the plan doesn't name the lane: one model instance, one job. */
export const DEFAULT_LANE_LIMIT = 1;

/**
 * What the hardware planner hands the job engine: how many jobs of each
 * class and of each lane may run at once. A lane never runs more than its
 * class's budget allows, whatever its own limit; battery and heat lower the
 * class budgets, not the lane limits.
 */
export interface JobConcurrencyPlan {
  /** The budget every lane of a class shares, and the limit for its jobs that have no lane. */
  readonly classes: Readonly<Record<ResourceClass, number>>;
  /** Per lane; a lane missing here gets DEFAULT_LANE_LIMIT. */
  readonly lanes: Readonly<Partial<Record<JobLane, number>>>;
  /**
   * Classes whose jobs run on another class's hardware on this machine and so
   * share its budget: `{ npu: 'gpu' }` where there's no Neural Engine and OCR
   * and speech run on CUDA (LNX1). A folded class's own budget is ignored; its
   * lanes keep their limits. One step only: the target is never folded itself.
   */
  readonly foldInto?: Readonly<Partial<Record<ResourceClass, ResourceClass>>>;
}

const budget = z.int().min(0).max(64);
const classBudgets: Record<ResourceClass, typeof budget> = {
  cpu: budget,
  gpu: budget,
  npu: budget,
  video: budget,
  io: budget,
  network: budget,
};

const resourceClass = z.enum(RESOURCE_CLASSES);

/** For a plan that crosses a process (diagnostics, the bench's run record): every class, lanes at least 1. */
export const jobConcurrencyPlanSchema: z.ZodType<JobConcurrencyPlan> = z
  .object({
    classes: z.strictObject(classBudgets),
    lanes: z.record(jobLaneSchema, z.int().min(1).max(64)),
    foldInto: z.partialRecord(resourceClass, resourceClass).optional(),
  })
  .refine((plan) => foldsOneStep(plan.foldInto), {
    message: 'A class folds into another class that is not folded itself.',
    path: ['foldInto'],
  });

function foldsOneStep(foldInto: JobConcurrencyPlan['foldInto']): boolean {
  if (!foldInto) return true;
  return Object.entries(foldInto).every(
    ([from, to]) => to !== undefined && to !== from && foldInto[to] === undefined,
  );
}

/** The class whose budget a job of `resource` draws on under `plan`. */
export function budgetClass(
  plan: Pick<JobConcurrencyPlan, 'foldInto'>,
  resource: ResourceClass,
): ResourceClass {
  return plan.foldInto?.[resource] ?? resource;
}

/** The lane's limit under `plan`, before the class budget caps it. */
export function laneLimit(plan: Pick<JobConcurrencyPlan, 'lanes'>, lane: JobLane): number {
  return plan.lanes[lane] ?? DEFAULT_LANE_LIMIT;
}
