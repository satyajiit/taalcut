// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shots from TransNetV2 (IX2-C4). The model reads the analysis pass's small RGB stream while the pass decodes
 * (the same one decode that leaves the analysis and OCR frames for the later stages), and its transitions are
 * the cuts (cuts/transitions.ts): a hard cut on the frame where the picture changes, a dissolve at its
 * middle. No embedding: `vision.shots` no longer waits for the embedder. Fades through black, which the model
 * doesn't mark, come from the pass's black runs (fades.ts, IX3-D2). Shots under `minShotMs` merge as before.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import { analysisPass, type PassAnalysis } from '../analysis/frame-pass';
import { VISION_CONFIG } from '../config';
import { streamPredictor } from '../cuts/stream-predictor';
import { TRANSNET_FRAME, type ShotBoundaryModel } from '../cuts/transnet';
import { transitionsFrom, type SharpestChange } from '../cuts/transitions';
import type { FrameSource } from '../media/frame-source';
import { markFades } from './fades';
import type { ScdetShotsDeps } from './scdet-shots';
import {
  mergeShortShots,
  shotsFromCuts,
  type DetectShotsResult,
  type ShotCut,
  type ShotsContext,
} from './shot-list';

const config = VISION_CONFIG.shots;

/** Grid frames between two stream frames: the whole number that brings the stream nearest `maxFps`. */
export function streamEvery(fps: number, maxFps: number = config.model.maxFps): number {
  // A source at or under the cap streams every frame.
  return fps <= maxFps ? 1 : Math.round(fps / maxFps);
}

/** What the model path needs beyond scdet's: the stream's rate cap, when an eval tries another (IX2-S3). */
export interface ModelShotsDeps extends ScdetShotsDeps {
  /** Default `VISION_CONFIG.shots.model.maxFps`. */
  readonly modelMaxFps?: number;
}

/** The grid frame in (after, upTo] with the highest full-grid scene score, and that score (the first on a tie). */
export function sharpestChange(pass: PassAnalysis, after: number, upTo: number): SharpestChange | undefined {
  let best: SharpestChange | undefined;
  for (let index = after + 1; index <= upTo && index < pass.fine.length; index++) {
    const score = pass.fine[index]?.[0] ?? 0;
    if (!best || score > best.score) best = { frame: index, score };
  }
  return best;
}

export async function modelShots(
  frames: FrameSource,
  model: ShotBoundaryModel,
  deps: ModelShotsDeps,
  ctx: ShotsContext,
): AsyncResult<DetectShotsResult> {
  const { signal } = ctx;
  const source = frames.video;
  const fps = source.rate.num / source.rate.den;
  const every = streamEvery(fps, deps.modelMaxFps);
  const predictor = streamPredictor(model, { ...TRANSNET_FRAME, every }, signal);
  const pass = await analysisPass(frames, {
    ...(deps.keepOcrFrames ? { keepOcrFrames: true } : {}),
    ...(deps.parallel ? { parallel: deps.parallel } : {}),
    ...(signal ? { signal } : {}),
    stream: predictor.stream,
  });
  if (!pass.ok) return pass;
  ctx.progress?.(0.8);
  const predicted = await predictor.finish(pass.value.frames);
  if (!predicted.ok) return predicted;
  const frameCount = Math.max(source.frameCount ?? 0, pass.value.frames);
  const transitions = transitionsFrom(predicted.value, {
    threshold: config.model.threshold,
    gradualFrames: config.model.gradualFrames,
    cutScore: config.model.cutScore,
    locate: (after, upTo) => sharpestChange(pass.value, after, upTo),
  });
  const found: ShotCut[] = transitions.map((t) => ({
    frame: t.frame,
    score: Math.round(t.probability * 1e4) / 1e4,
    method: 'model',
    kind: t.kind,
    span: t.span,
  }));
  const marked = markFades(found, pass.value, { fps, frameCount, method: 'model' });
  const cuts = mergeShortShots(marked, frameCount, Math.round((config.minShotMs / 1000) * fps));
  ctx.progress?.(1);
  return ok({
    detector: 'model',
    backend: model.backend,
    frameRate: source.rate,
    frameCount,
    shots: shotsFromCuts(
      cuts.map((c) => c.frame),
      frameCount,
      source.rate,
    ),
    cuts,
    rejected: marked.filter((cut) => !cuts.includes(cut)),
  });
}
