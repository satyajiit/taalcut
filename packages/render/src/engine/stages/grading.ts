// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The grading stage (P3-V17, SPEC P3.7): when the render's Style has a grade, one baked `.cube` per video clip
 * (vision's `vision.bakeGrade` through the GradeLutSource, awaited), then each conformed segment graded GPU
 * first (the mac helper's `video.applyCube`, else FFmpeg `lut3d` with compute.fallback). Stills keep their
 * look: the helper reads video. Without a LUT source a graded Style renders ungraded, with a warning.
 */
import { join } from 'node:path';
import { ok, RationalTime, type AsyncResult, type RenderRecord, type Style } from '@taalcut/core';
import { gradeSegment, type CubeApplier } from '../../grade';
import type { PlannedVisual, RenderPlan } from '../../plan/types';
import { exportJobOf } from '../../ports-phase3';
import type { ConformedSegment } from '../conform';
import type { RenderEngineDeps } from '../deps';
import type { ExportInputs } from '../export-inputs';
import type { ProgressTracker } from '../progress';
import type { StageContext } from './context';
import type { PictureExtras } from './picture';

/** The conform's mezzanine bitrate: a graded segment is one more generation at the same quality. */
const GRADED_BITRATE_KBPS = 40_000;

export interface GradingPlan {
  /** The baked cube per visual id. */
  readonly cubes: ReadonlyMap<string, string>;
  readonly warnings: readonly string[];
}

export const NO_GRADING: GradingPlan = { cubes: new Map(), warnings: [] };

/** Whether this export runs the grading stage. */
export const hasGrade = (inputs: ExportInputs) => inputs.styled.style?.grade != null;

/** What baking the cubes reads of the export: the grade source, the render's job, and the planned clips. */
export interface GradingStage {
  readonly deps: Pick<RenderEngineDeps, 'grades'>;
  readonly record: Pick<RenderRecord, 'jobId'>;
  readonly signal: AbortSignal;
  readonly tracker: Pick<ProgressTracker, 'stage' | 'within'>;
}
export interface GradingInputs {
  readonly styled: { readonly style: Pick<Style, 'grade'> | null };
  readonly plan: Pick<RenderPlan, 'visuals' | 'rate'>;
}

/** The clip's source range for its look: from its in-point, as long as it plays (at its mean speed). */
function sourceRange(visual: PlannedVisual, inputs: GradingInputs) {
  const frames = Math.max(1, Math.round((visual.visible.end - visual.visible.start) * visual.meanSpeed));
  return { start: visual.sourceIn, duration: RationalTime.of(frames, inputs.plan.rate) };
}

/** One baked cube per video clip, each bake run as the export job's child (it holds the 'gpu' slot). */
export async function planGrading(stage: GradingStage, inputs: GradingInputs): AsyncResult<GradingPlan> {
  const grade = inputs.styled.style?.grade;
  if (!grade) return ok(NO_GRADING);
  const source = stage.deps.grades;
  if (!source) return ok({ cubes: new Map(), warnings: ['grade not applied: no LUT baker in this process'] });
  stage.tracker.stage('grading');
  const videos = inputs.plan.visuals.filter((visual) => visual.enabled && visual.kind === 'video');
  const cubes = new Map<string, string>();
  const bakedByRange = new Map<string, string>();
  for (const [index, visual] of videos.entries()) {
    const range = sourceRange(visual, inputs);
    const cacheKey = `${visual.assetId}:${range.start.value}/${range.start.rate.num}/${range.start.rate.den}:${range.duration.value}/${range.duration.rate.num}/${range.duration.rate.den}`;
    const existing = bakedByRange.get(cacheKey);
    if (existing !== undefined) {
      cubes.set(visual.id, existing);
    } else {
      const cube = await source.lutFor(visual.assetId, range, grade, stage.signal, exportJobOf(stage.record));
      if (!cube.ok) return cube;
      bakedByRange.set(cacheKey, cube.value);
      cubes.set(visual.id, cube.value);
    }
    stage.tracker.within((index + 1) / videos.length, {
      completed: index + 1,
      total: videos.length,
      unit: 'items',
    });
  }
  return ok({ cubes, warnings: [] });
}

/** The conform hook that grades each segment with its cube. */
export function gradeAfterConform(
  stage: StageContext,
  inputs: ExportInputs,
  grading: GradingPlan,
  applier: CubeApplier | null,
): PictureExtras['afterConform'] {
  if (grading.cubes.size === 0) return undefined;
  const fps = Math.round(inputs.plan.rate.num / inputs.plan.rate.den);
  return async (visual: PlannedVisual, segment: ConformedSegment): AsyncResult<ConformedSegment> => {
    const cubePath = grading.cubes.get(visual.id);
    if (!cubePath || segment.ext !== 'mp4') return ok(segment);
    const graded = await gradeSegment({
      segment: segment.file,
      segmentKey: segment.key,
      cubePath,
      dir: join(stage.deps.folders.conform, 'graded'),
      applier,
      ctx: stage.deps.media,
      bitrateKbps: GRADED_BITRATE_KBPS,
      gopFrames: fps,
      signal: stage.signal,
      onFallback: stage.fallback,
    });
    return graded.ok ? ok({ ...segment, file: graded.value.file, key: graded.value.key }) : graded;
  };
}
