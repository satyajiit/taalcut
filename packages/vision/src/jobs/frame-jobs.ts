// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How vision's indexing jobs read an asset's frames (IX-D1, IX-D2, IX-D3,
 * IX-D6): one frame source per job over the jobs process's frame cache, from
 * normalise's plan when the stage passed it (no probe), with every FFmpeg
 * and ffprobe run counted for the job's `decodes`. The stage that runs the
 * analysis pass names the stages that will read what it leaves; each of them
 * releases the asset when it succeeds, and the last release deletes its
 * frames (as does the asset's indexing ending, or an idle sweep).
 */
import { ok, type AsyncResult } from '@taalcut/core';
import { settledPlan, type DecodeCount, type NormalisationPlan } from '@taalcut/media';
import type { FrameSource } from '../media/frame-source';
import { openFrameSource } from '../media/media-frame-source';
import type { VisionJobDeps } from './deps';

/** The cache's consumer names: the stages that read what `vision.shots` left. */
export const FRAME_CONSUMERS = {
  analyse: 'vision.analyse',
  ocr: 'vision.ocr',
  embed: 'vision.embed',
  describe: 'vision.describe',
} as const;

export interface FrameJobInput {
  readonly assetId: string;
  readonly path: string;
  readonly plan?: NormalisationPlan;
  readonly proxyKey?: string;
}

/** The proxy to decode instead of the original: on the asset's grid, already upright and tone-mapped. */
function proxyOf(deps: VisionJobDeps, input: FrameJobInput) {
  const path = input.proxyKey && input.plan ? deps.derivedPath?.(input.proxyKey) : undefined;
  if (!path || !input.plan) return undefined;
  return { path, plan: settledPlan(input.plan, input.plan.frameRate.output) };
}

export interface FrameJobUse {
  /** The stages that will read what this job leaves (the producer names them). */
  readonly expect?: readonly string[];
  /** This job's consumer name: released when it succeeds (a failed job's retry still finds the frames). */
  readonly consumer?: string;
}

export async function withAssetFrames<T>(
  deps: VisionJobDeps,
  input: FrameJobInput,
  signal: AbortSignal,
  use: FrameJobUse,
  run: (frames: FrameSource) => AsyncResult<T>,
): AsyncResult<{ readonly value: T; readonly decodes: DecodeCount }> {
  const proxy = proxyOf(deps, input);
  const opened = await openFrameSource(
    {
      media: deps.media,
      tempDir: deps.tempDir,
      ...(deps.frameCache ? { cache: deps.frameCache } : {}),
      ...(deps.decodeProfile ? { profile: deps.decodeProfile } : {}),
      ...(deps.decodeService ? { decodeService: deps.decodeService } : {}),
    },
    {
      assetId: input.assetId,
      path: input.path,
      ...(input.plan ? { plan: input.plan } : {}),
      ...(proxy ? { proxy } : {}),
      signal,
    },
  );
  if (!opened.ok) return opened;
  const frames = opened.value;
  if (use.expect) frames.expect(use.expect);
  const result = await run(frames).finally(() => frames.close());
  if (!result.ok) return result;
  if (use.consumer) await frames.release(use.consumer);
  return ok({ value: result.value, decodes: frames.decodes() });
}
