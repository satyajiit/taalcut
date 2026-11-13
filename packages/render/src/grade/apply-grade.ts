// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Applying a clip's grade to its conformed segment (SPEC P3.7), GPU first (ADR 0002). The GPU route is the mac
 * helper's Core Image path through the `CubeApplier` port where there is one, else (Linux; LNX1-RND) libplacebo's
 * LUT on Vulkan (grade-video.ts). The CPU route runs only when there is neither, the applier can't take the cube's
 * size, or the GPU route failed: FFmpeg's `lut3d` (LGPL-2.1-or-later, links nothing, so the LGPL build stays LGPL),
 * reported as `compute.fallback`. Every FFmpeg route decodes and encodes on the machine's hardware video rows
 * (VideoToolbox on a Mac, NVDEC/NVENC on NVIDIA); when that hardware fails on the CPU route (it won't start, or
 * can't take the file), the shared software retry runs it once more with a software decode and OpenH264
 * (engine/hardware-route.ts, IX3-K4). The applier holds two hardware sessions until the helper lets go of its
 * request, and the CPU route starts only after that (helper-hold.ts).
 *
 * Every route reads the segment's BT.709 limited-range YUV as full-range BT.709 R′G′B′, the encoding the cube
 * was fitted in, and writes BT.709 limited range back (zscale on the CPU route; zimg is WTFPL, already in the
 * LGPL build). Graded segments are cached next to the conform cache
 * by the segment's key and the cube's sha256, so a resumed export grades nothing twice.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import {
  err,
  ok,
  type AsyncResult,
  type ComputeBackend,
  type ComputeFallbackEvent,
  type ComputeFallbackReason,
} from '@taalcut/core';
import { filterPathArg, runFfmpeg, type MediaContext } from '@taalcut/media';
import { z } from 'zod';
import { onHardwareRoute } from '../engine/hardware-route';
import {
  hardwareLabel,
  softwareVideoRoute,
  usesHardware,
  wantedBy,
  type VideoRoute,
} from '../engine/video-route';
import { GradeFailed } from '../errors-phase3';
import type { CubeApplier } from './cube-applier';
import type { CubeLut } from './cube-file';
import {
  cpuGradeFilter,
  gradeArgs,
  planGradeRoute,
  vulkanGrade,
  vulkanGradeFilter,
  VULKAN_GRADE,
} from './grade-video';
import { holdForHelper, untilLetGo } from './helper-hold';

export { cpuGradeFilter, vulkanGradeFilter };

export interface ApplyGradeInput {
  /** The conformed segment (video only; its sound is the WAV beside it). */
  readonly segment: string;
  /** The validated `.cube` (readCube) on disk, and its parsed table. */
  readonly cubePath: string;
  readonly cube: CubeLut;
  /** Where the graded segment goes (gradedKey names it); reused when it is already there. */
  readonly out: string;
  /** The GPU route on a Mac; null or absent where there is none (not macOS, no helper). */
  readonly applier?: CubeApplier | null;
  /** Without an applier, try libplacebo's LUT on Vulkan first (default true; false: straight to the CPU route). */
  readonly vulkan?: boolean;
  readonly ctx: MediaContext;
  /** The CPU route's encode: the conform's mezzanine bitrate. */
  readonly bitrateKbps: number;
  /** Keyframe interval in frames (the conform uses one a second). */
  readonly gopFrames?: number;
  readonly signal?: AbortSignal;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
}

export interface GradedSegment {
  readonly file: string;
  readonly route: 'gpu' | 'cpu';
}

/**
 * Bump when any route's output changes, so cached graded segments stop matching.
 * 2: the Vulkan route, and every route on the machine's encoder with media's flags (LNX1-RND).
 */
export const GRADE_RECIPE = 2;

/** The cache key of a graded segment: the segment's content key and the cube's bytes. */
export function gradedKey(segmentKey: string, cubeSha256: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ recipe: GRADE_RECIPE, segmentKey, cubeSha256 }))
    .digest('hex')
    .slice(0, 40);
}

/** A path as one lut3d option value inside a filtergraph: media's two-level FFmpeg quoting. */
export { filterPathArg };

const cachedSchema = z.object({ route: z.enum(['gpu', 'cpu']), recipe: z.int() });

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Why the CPU route runs, and what it was wanted instead of. */
interface CpuReason {
  readonly wanted: readonly ComputeBackend[];
  readonly reason: ComputeFallbackReason;
  readonly detail: string;
}

const fallback = (input: ApplyGradeInput, why: CpuReason) =>
  input.onFallback?.({
    operation: 'render.grade',
    wanted: [...why.wanted],
    reason: why.reason,
    detail: why.detail.slice(0, 2000),
  });

const METAL: readonly ComputeBackend[] = ['metal'];

/** The GPU route (the applier, else Vulkan), or why the CPU route runs instead (null: the GPU route graded it). */
async function tryGpu(input: ApplyGradeInput, temp: string): AsyncResult<CpuReason | null> {
  const applier = input.applier;
  if (!applier) {
    if (input.vulkan === false)
      return ok({ wanted: METAL, reason: 'no_accelerator', detail: 'No GPU cube applier on this platform' });
    return tryVulkan(input, temp);
  }
  const why = await tryApplier(input, applier, temp);
  return why.ok && why.value ? ok({ wanted: METAL, ...why.value }) : why.ok ? ok(null) : why;
}

/** libplacebo's LUT on Vulkan, on the machine's decode and encode; a failed run is `accelerator_failed`. */
async function tryVulkan(input: ApplyGradeInput, temp: string): AsyncResult<CpuReason | null> {
  const gate = await vulkanGrade(input.ctx, input.signal);
  if (!gate.ok) return gate;
  if (gate.value !== true)
    return ok({
      wanted: VULKAN_GRADE,
      reason: gate.value.unavailable ? 'no_accelerator' : 'disabled',
      detail: gate.value.detail,
    });
  const planned = await planGradeRoute(input.ctx, input.signal);
  if (!planned.ok) return planned;
  for (const event of planned.value.fallbacks) input.onFallback?.(event);
  const route = planned.value.route;
  const run = await runFfmpeg(input.ctx, gradeArgs(input, temp, route, vulkanGradeFilter(input.cubePath)), {
    // A hardware decode or encode is never killed on a stop (IX3-K2).
    holdsVideoSession: usesHardware(route),
    timeoutMs: 15 * 60_000,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (run.ok) return ok(null);
  await rm(temp, { force: true });
  if (run.error.code === 'media.cancelled' || input.signal?.aborted) return run;
  return ok({
    wanted: VULKAN_GRADE,
    reason: 'accelerator_failed',
    detail: `libplacebo on Vulkan failed: ${(run.error.detail ?? run.error.code).slice(-300)}`,
  });
}

/** The mac helper's Core Image route, or why the CPU route runs instead (null: it graded the segment). */
async function tryApplier(
  input: ApplyGradeInput,
  applier: CubeApplier,
  temp: string,
): AsyncResult<{ readonly reason: ComputeFallbackReason; readonly detail: string } | null> {
  if (!applier.sizes.includes(input.cube.size))
    return ok({
      reason: 'unsupported_input',
      detail: `The GPU applier takes ${applier.sizes.join(', ')}³ cubes; this one is ${input.cube.size}³`,
    });
  const hold = await holdForHelper(input.ctx, input.signal);
  if (!hold.ok) return hold;
  const applied = await applier.apply(
    { input: input.segment, output: temp, cube: input.cubePath, colourSpace: 'bt709' },
    {
      ...(input.signal ? { signal: input.signal } : {}),
      onSend: hold.value.onSend,
      onLetGo: hold.value.onLetGo,
    },
  );
  if (applied.ok) {
    // An answer is the helper letting go, whatever the applier reports; the CPU route waits for the sessions.
    hold.value.onLetGo();
    await hold.value.done;
    return ok(
      applied.value.kind === 'noAccelerator'
        ? { reason: 'no_accelerator', detail: applied.value.detail }
        : null,
    );
  }
  // A cancelled run or a cube the helper refuses ends here: the CPU route would only repeat it. A cancel's sessions
  // go back when the helper lets go, which may be after this returns.
  if (applied.error.code === 'core.cancelled' || applied.error.code === 'render.cube_invalid') {
    await rm(temp, { force: true });
    return applied;
  }
  // The CPU route starts only once the helper has let go (its answer or its exit) and is done with its output
  // (IX3-F5, H5).
  const free = await untilLetGo(hold.value, input.signal);
  await rm(temp, { force: true });
  if (!free.ok) return free;
  return ok({ reason: 'accelerator_failed', detail: `${applied.error.code}: ${applied.error.detail ?? ''}` });
}

async function runCpu(input: ApplyGradeInput, temp: string): AsyncResult<void> {
  const planned = await planGradeRoute(input.ctx, input.signal);
  if (!planned.ok) return planned;
  for (const event of planned.value.fallbacks) input.onFallback?.(event);
  const first = planned.value.route;
  const run = await onHardwareRoute<VideoRoute, unknown>(
    {
      first,
      software: usesHardware(first) ? softwareVideoRoute(input.ctx.platform) : undefined,
      // Reported like the conform's decode; any hardware failure here, as before.
      operation: 'render.gradeDecode',
      wanted: wantedBy(first),
      label: hardwareLabel(first),
      anyFfmpegFailure: true,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onFallback ? { onFallback: input.onFallback } : {}),
    },
    (route) =>
      runFfmpeg(input.ctx, gradeArgs(input, temp, route, cpuGradeFilter(input.cubePath)), {
        // A hardware decode or encode: never killed on a stop (IX3-K2).
        holdsVideoSession: usesHardware(route),
        timeoutMs: 15 * 60_000,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
  );
  if (!run.ok) {
    await rm(temp, { force: true });
    return run;
  }
  return ok(undefined);
}

/** Grades one segment; a graded segment already at `out` is reused. */
export async function applyGrade(input: ApplyGradeInput): AsyncResult<GradedSegment> {
  const meta = `${input.out}.json`;
  const cached = await readFile(meta, 'utf8').then(
    (text) => {
      try {
        return cachedSchema.safeParse(JSON.parse(text));
      } catch {
        // A torn meta file is a cache miss: the segment is graded again.
        return null;
      }
    },
    () => null,
  );
  if (cached?.success && cached.data.recipe === GRADE_RECIPE && (await exists(input.out)))
    return ok({ file: input.out, route: cached.data.route });
  // Its own temporary name: two clips with the same graded key may grade at once (see conform.ts).
  const temp = `${input.out}.${randomUUID().slice(0, 8)}.part.mp4`;
  const gpu = await tryGpu(input, temp);
  if (!gpu.ok) return gpu;
  let route: GradedSegment['route'] = 'gpu';
  if (gpu.value) {
    fallback(input, gpu.value);
    const cpu = await runCpu(input, temp);
    if (!cpu.ok) {
      const cancelled = cpu.error.code === 'media.cancelled' || cpu.error.code === 'core.cancelled';
      return cancelled
        ? cpu
        : err(GradeFailed(undefined, { detail: (cpu.error.detail ?? cpu.error.code).slice(-2000) }));
    }
    route = 'cpu';
  }
  await rename(temp, input.out);
  await writeFile(meta, JSON.stringify({ route, recipe: GRADE_RECIPE }));
  return ok({ file: input.out, route });
}
