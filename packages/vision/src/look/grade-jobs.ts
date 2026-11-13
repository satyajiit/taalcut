// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * vision.measureLook (GPU decode, CPU reduction) and vision.bakeGrade (CPU).
 * The kinds are core's strings and zod schemas; handlers take a narrow port, not VisionJobDeps.
 */
import { createHash } from 'node:crypto';
import {
  BAKE_GRADE_JOB_KIND,
  bakeGradeJobInputSchema,
  bakeGradeJobOutputSchema,
  CancelledError,
  computeFallbackEvent,
  defineJobKind,
  err,
  MEASURE_LOOK_JOB_KIND,
  measureLookJobInputSchema,
  measureLookJobOutputSchema,
  ok,
  registerJob,
  selectBackend,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type ComputeBackend,
  type ComputeFallbackEvent,
  type DerivedFileRef,
  type JobRegistration,
  type LookStats,
  type Result,
  type RetryPolicy,
  type TimeRange,
} from '@taalcut/core';
import type { ZodType } from 'zod';
import { VISION_CONFIG } from '../config';
import { writeCube } from './cube-writer';
import { GradeFailed, LookUnavailable } from './errors';
import { measureLook, type LookFrame } from './look-stats';
import { reinhardMap } from './reinhard';

const RETRY: RetryPolicy = { maxAttempts: 2, backoff: { kind: 'fixed', delayMs: 500 } };
const MINUTE = 60_000;
/** Wanted order for the reduction. v1 has no Metal kernel, so production passes only cpu. */
const REDUCTION: readonly ComputeBackend[] = ['metal', 'cpu'];

export interface LookFrameSource {
  sample(assetId: AssetId, range: TimeRange, signal: AbortSignal): AsyncResult<readonly LookFrame[]>;
}

export interface GradeLutSink {
  write(assetId: AssetId, cubeText: string, key: string): AsyncResult<DerivedFileRef>;
}

export interface LookJobDeps {
  readonly frames: LookFrameSource;
  readonly luts: GradeLutSink;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /** Present backends. Default is CPU only: the reduction does not pretend a GPU kernel ran. */
  readonly available?: readonly ComputeBackend[];
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function rangeParts(range: TimeRange): readonly number[] {
  return [
    range.start.value,
    range.start.rate.num,
    range.start.rate.den,
    range.duration.value,
    range.duration.rate.num,
    range.duration.rate.den,
  ];
}

function jobKey(kind: string, payload: string): string {
  return `${kind}:v${VISION_CONFIG.version}:${sha256(payload)}`;
}

function parseJob<T>(schema: ZodType<T>, input: unknown): Result<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return err(ValidationError({ field: 'input' }));
  return ok(parsed.data);
}

export const visionMeasureLookJob = defineJobKind({
  kind: MEASURE_LOOK_JOB_KIND,
  input: measureLookJobInputSchema,
  output: measureLookJobOutputSchema,
  // Decode-bound: the hardware decode is the job. The lαβ reduction is CPU and records its own fallback.
  resource: 'video',
  priority: 'normal',
  retry: RETRY,
  timeoutMs: 10 * MINUTE,
  idempotencyKey: (input) =>
    jobKey(MEASURE_LOOK_JOB_KIND, JSON.stringify([input.assetId, rangeParts(input.range)])),
});

export const visionBakeGradeJob = defineJobKind({
  kind: BAKE_GRADE_JOB_KIND,
  input: bakeGradeJobInputSchema,
  output: bakeGradeJobOutputSchema,
  resource: 'cpu',
  priority: 'normal',
  retry: RETRY,
  timeoutMs: 2 * MINUTE,
  idempotencyKey: (input) =>
    jobKey(
      BAKE_GRADE_JOB_KIND,
      JSON.stringify([
        input.assetId,
        rangeParts(input.range),
        input.target.encoding,
        input.target.mean,
        input.target.std,
        input.target.frames,
        input.target.pixels,
        input.strength,
        input.cubeSize,
      ]),
    ),
});

function cubeKey(payload: string): string {
  const digest = sha256(payload);
  return `grades/${digest.slice(0, 2)}/${digest}.v1.cube`;
}

type LookJobKind = typeof MEASURE_LOOK_JOB_KIND | typeof BAKE_GRADE_JOB_KIND;

export function createLookJobs(deps: LookJobDeps): JobRegistration[] {
  const available = deps.available ?? ['cpu'];
  // One record per job kind per jobs object: the missing kernel is a property of this build, not of each clip.
  const recorded = new Set<LookJobKind>();

  function noteReduction(kind: LookJobKind): Result<void> {
    const choice = selectBackend(REDUCTION, available, {
      fallbackReason: 'no_accelerator',
      detail: 'the lαβ reduction and the cube bake have no Metal kernel in v1',
    });
    if (!choice.ok) return choice;
    if (choice.value.fallback && !recorded.has(kind)) {
      recorded.add(kind);
      deps.onFallback?.(computeFallbackEvent(kind, REDUCTION, choice.value.fallback));
    }
    return ok(undefined);
  }

  async function sourceStats(
    kind: LookJobKind,
    assetId: AssetId,
    range: TimeRange,
    signal: AbortSignal,
  ): AsyncResult<LookStats> {
    if (signal.aborted) return err(CancelledError());
    const noted = noteReduction(kind);
    if (!noted.ok) return err(LookUnavailable(undefined, { detail: 'no compute backend' }));
    const sampled = await deps.frames.sample(assetId, range, signal);
    if (!sampled.ok) return sampled;
    if (signal.aborted) return err(CancelledError());
    return measureLook(sampled.value);
  }

  return [
    registerJob(visionMeasureLookJob, async (input, context) => {
      const parsed = parseJob(measureLookJobInputSchema, input);
      if (!parsed.ok) return parsed;
      const look = await sourceStats(
        MEASURE_LOOK_JOB_KIND,
        parsed.value.assetId,
        parsed.value.range,
        context.signal,
      );
      if (!look.ok) return look;
      return ok({ look: look.value });
    }),
    registerJob(visionBakeGradeJob, async (input, context) => {
      const parsed = parseJob(bakeGradeJobInputSchema, input);
      if (!parsed.ok) return parsed;
      const { assetId, range, target, strength, cubeSize } = parsed.value;
      const source = await sourceStats(BAKE_GRADE_JOB_KIND, assetId, range, context.signal);
      if (!source.ok) return source;
      if (source.value.encoding !== target.encoding) {
        return err(GradeFailed(undefined, { detail: 'source and target encodings differ' }));
      }
      const cube = writeCube({
        size: cubeSize,
        sample: (node) => reinhardMap(node, source.value, target, strength),
      });
      const payload = JSON.stringify([assetId, rangeParts(range), target, strength, cubeSize]);
      const written = await deps.luts.write(assetId, cube, cubeKey(payload));
      if (!written.ok) return written;
      return ok({ lut: written.value });
    }),
  ];
}
