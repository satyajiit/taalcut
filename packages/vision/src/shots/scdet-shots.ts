// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shots by scdet for recall and embedding distance for precision (P2-L7): the detector before TransNetV2,
 * and its fallback when the model isn't installed or fails (IX2-C4).
 *
 * 1. scdet at about 10 samples a second (256 px): every score ≥ 8 is a candidate.
 * 2. Each candidate is located to the frame by scdet over the full grid
 *    around it (±150 ms); the highest score wins, and its shape says whether
 *    it looks like a flash (the next frame changes back).
 *    Both come from one decode, the asset's analysis pass (IX-D2,
 *    analysis/frame-pass.ts), which also leaves the frame statistics and OCR
 *    frames for `vision.analyse`: the full-grid scores are the whole file's,
 *    so a window's first frames score against the frames before them.
 * 3. The frames 2 before the cut and 1 after it are embedded. A cut needs a
 *    distance ≥ `shots.minDistance`; a flash-shaped peak needs
 *    `shots.confirmDistance`. Below that it is a flash, a light change or
 *    motion within one shot, and is rejected.
 * 4. A fade through black is one boundary in the middle of its black frames, in place of the cuts at its ends
 *    (fades.ts, IX3-D2).
 * 5. Shots under 0.5 s merge into the previous one (the first into the next). No cut: one shot.
 * Without the embedding model the second method can't run: peaks at or above
 * `cuts.unverifiedKeepScore` that aren't flash-shaped are kept, `method: 'scdet'`.
 */
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { analysisPass, type PassAnalysis } from '../analysis/frame-pass';
import { VISION_CONFIG } from '../config';
import type { VisionEmbedder } from '../embed/embedder';
import type { FrameSource } from '../media/frame-source';
import type { VideoSource } from '../media/frames';
import type { SceneSample } from '../media/scene';
import { locate, pairDistances, type Located } from './confirm';
import { markFades } from './fades';
import {
  mergeShortShots,
  shotsFromCuts,
  type DetectShotsResult,
  type ShotCut,
  type ShotsContext,
} from './shot-list';

export interface ScdetShotsDeps {
  readonly media: MediaContext;
  /** Absent: scdet alone decides (see above). */
  readonly embedder?: VisionEmbedder;
  /** Keep the frames OCR reads while the pass decodes (when `vision.analyse` will read text). */
  readonly keepOcrFrames?: boolean;
  /** Segments of a long video the pass may decode at once (IX-D7). */
  readonly parallel?: number;
}

const config = VISION_CONFIG.shots;

/** The grid frames in (start, end) with their full-grid scores. */
export function fineWindow(pass: PassAnalysis, start: number, end: number): SceneSample[] {
  const out: SceneSample[] = [];
  for (let index = start + 1; index < end && index < pass.fine.length; index++) {
    const [score, mafd] = pass.fine[index] ?? [0, 0];
    out.push({ index, score, mafd });
  }
  return out;
}

export async function scdetShots(
  frames: FrameSource,
  deps: ScdetShotsDeps,
  ctx: ShotsContext,
): AsyncResult<DetectShotsResult> {
  const { signal } = ctx;
  const source = frames.video;
  const fps = source.rate.num / source.rate.den;
  const pass = await analysisPass(frames, {
    ...(deps.keepOcrFrames ? { keepOcrFrames: true } : {}),
    ...(deps.parallel ? { parallel: deps.parallel } : {}),
    ...(signal ? { signal } : {}),
  });
  if (!pass.ok) return pass;
  ctx.progress?.(0.6);
  const every = pass.value.coarseEvery;
  const coarse = pass.value.coarse.map(([score, mafd], i) => ({ index: i * every, score, mafd }));
  const frameCount = Math.max(source.frameCount ?? 0, (coarse.at(-1)?.index ?? 0) + 1);

  const located: Located[] = [];
  const reach = Math.max(1, Math.round((config.locateMs / 1000) * fps));
  for (const candidate of coarse.filter((s) => s.index > 0 && s.score >= config.candidateScore)) {
    if (signal?.aborted) return err(CancelledError());
    const start = Math.max(0, candidate.index - every - reach);
    const end = Math.min(frameCount, candidate.index + reach + 1);
    const cut = locate(fineWindow(pass.value, start, end)) ?? {
      frame: candidate.index,
      score: candidate.score,
      flashLike: false,
    };
    if (!located.some((c) => Math.abs(c.frame - cut.frame) <= 1)) located.push(cut);
  }
  ctx.progress?.(0.7);

  const decided = await confirm(located, source, { ...deps, frames }, signal);
  if (!decided.ok) return decided;
  const minFrames = Math.round((config.minShotMs / 1000) * fps);
  const marked = markFades(decided.value.cuts, pass.value, { fps, frameCount, method: 'scdet' });
  const cuts = mergeShortShots(marked, frameCount, minFrames);
  ctx.progress?.(1);
  return ok({
    detector: 'scdet',
    frameRate: source.rate,
    frameCount,
    shots: shotsFromCuts(
      cuts.map((c) => c.frame),
      frameCount,
      source.rate,
    ),
    cuts,
    rejected: decided.value.rejected,
  });
}

/**
 * The second method. With embeddings: a cut needs the frames around it to
 * differ (`minDistance`); a flash-shaped peak needs `confirmDistance`.
 * Without: scdet alone, minus flash shapes, from `cuts.unverifiedKeepScore`.
 */
export function decide(candidate: Located, distance: number | undefined): ShotCut | null {
  const base = { frame: candidate.frame, score: candidate.score };
  if (distance === undefined) {
    const keep = !candidate.flashLike && candidate.score >= VISION_CONFIG.cuts.unverifiedKeepScore;
    return keep ? { ...base, method: 'scdet' } : null;
  }
  if (distance < config.minDistance) return null;
  if (candidate.flashLike && distance < config.confirmDistance) return null;
  return { ...base, distance, method: 'both' };
}

async function confirm(
  located: readonly Located[],
  source: VideoSource,
  deps: ScdetShotsDeps & { readonly frames: FrameSource },
  signal: AbortSignal | undefined,
): AsyncResult<{ cuts: ShotCut[]; rejected: ShotCut[] }> {
  const cuts: ShotCut[] = [];
  const rejected: ShotCut[] = [];
  const distances = await pairDistances(located, source, deps, signal);
  // Any other failure of the second method (the model isn't installed) leaves scdet to decide.
  if (!distances.ok && distances.error.code === 'core.cancelled') return distances;
  for (const [i, candidate] of located.entries()) {
    const distance = distances.ok ? distances.value[i] : undefined;
    const cut = decide(candidate, distance);
    if (cut) cuts.push(cut);
    else {
      const method = distance === undefined ? 'scdet' : 'both';
      rejected.push({
        frame: candidate.frame,
        score: candidate.score,
        method,
        ...(distance === undefined ? {} : { distance }),
      });
    }
  }
  const byFrame = (a: ShotCut, b: ShotCut) => a.frame - b.frame;
  return ok({ cuts: cuts.sort(byFrame), rejected: rejected.sort(byFrame) });
}
