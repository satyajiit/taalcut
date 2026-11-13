// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shot detection in user footage: which detector decides. TransNetV2 (IX2-C4, model-shots.ts) when its
 * component loads; otherwise, or when the model fails on a window, scdet with the embedding check (P2-L7,
 * scdet-shots.ts), logged as a `compute.fallback` for `vision.shotBoundaries` (ADR 0002: the detector that
 * runs on the device gave way to scdet, which runs on the CPU). A failure that came from the model reads the
 * pass's document the model run left, so the fallback decodes nothing again.
 */
import {
  computeFallbackEvent,
  cpuFallback,
  type AsyncResult,
  type ComputeFallbackEvent,
} from '@taalcut/core';
import type { ShotBoundaryModel } from '../cuts/transnet';
import { TRANSNET_OPERATION } from '../cuts/transnet';
import type { FrameSource } from '../media/frame-source';
import { withFrameSource } from '../media/media-frame-source';
import { modelShots, type ModelShotsDeps } from './model-shots';
import { scdetShots } from './scdet-shots';
import type { DetectShotsResult, ShotsContext } from './shot-list';

export { decide } from './scdet-shots';
export {
  mergeShortShots,
  shotsFromCuts,
  type DetectShotsResult,
  type ShotCut,
  type ShotsContext,
} from './shot-list';

export interface DetectShotsDeps extends ModelShotsDeps {
  /** The asset's frame source (the job's, over the frame cache). Absent: one over `path`, closed here. */
  readonly frames?: FrameSource;
  /** The shot-boundary model, opened from its component. Absent or failing: scdet and the embedding check. */
  readonly boundaryModel?: (signal?: AbortSignal) => AsyncResult<ShotBoundaryModel>;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
}

/**
 * The backends the model would have run on, for the fallback record: the Mac's, best first (IX2-S10): Core ML in
 * the mac helper, then ONNX Runtime's (cuts/backends.ts).
 */
const MODEL_BACKENDS = ['coreml', 'webgpu', 'cpu'] as const;

/** The `compute.fallback` record when scdet decides in the model's place. */
export function shotFallback(
  reason: 'no_accelerator' | 'accelerator_failed',
  detail: string,
): ComputeFallbackEvent {
  const choice = cpuFallback(reason, `${detail}; scdet and the embedding check decide`);
  if (choice.backend !== 'cpu') throw new Error('unreachable');
  return computeFallbackEvent(TRANSNET_OPERATION, MODEL_BACKENDS, choice.fallback);
}

async function detectIn(
  frames: FrameSource,
  deps: DetectShotsDeps,
  ctx: ShotsContext,
): AsyncResult<DetectShotsResult> {
  const model = deps.boundaryModel ? await deps.boundaryModel(ctx.signal) : undefined;
  if (model?.ok) {
    const found = await modelShots(frames, model.value, deps, ctx);
    if (found.ok || found.error.code !== 'vision.shot_model_failed') return found;
    deps.onFallback?.(shotFallback('accelerator_failed', found.error.detail ?? found.error.code));
  } else if (model && model.error.code === 'core.cancelled') {
    return model;
  } else {
    const why = model ? (model.error.detail ?? model.error.code) : 'no shot-boundary model in this process';
    deps.onFallback?.(shotFallback('no_accelerator', why));
  }
  return scdetShots(frames, deps, ctx);
}

export async function detectShots(
  path: string,
  deps: DetectShotsDeps,
  ctx: ShotsContext = {},
): AsyncResult<DetectShotsResult> {
  return withFrameSource(deps.frames, deps.media, path, ctx.signal, (frames) => detectIn(frames, deps, ctx));
}
