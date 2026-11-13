// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What every shot detector hands back (P2-L7, IX2-C4): the cuts it kept, and the shots they make. A cut is the
 * first frame of the new shot on the source grid; shots tile the asset (core's shot contract), shorter ones
 * merged into a neighbour.
 */
import { RationalTime, type ComputeBackend, type FrameRate, type TimeRange } from '@taalcut/core';

export interface ShotCut {
  /** First frame of the new shot, on the source grid. */
  readonly frame: number;
  /**
   * scdet's score, 0–100 (methods `scdet` and `both`), or the model's probability, 0–1 (method `model`). A fade
   * takes the strongest boundary it replaced, 0 when the detector marked none there (shots/fades.ts).
   */
  readonly score: number;
  /** Cosine distance between the frames around the cut, when it was measured. */
  readonly distance?: number;
  /** `model`: the shot-boundary model (TransNetV2) decided the asset; the others: scdet, with or without embeddings. */
  readonly method: 'scdet' | 'both' | 'model';
  /**
   * What the transition is: a hard cut, a gradual one the boundary is the middle of (the model's dissolve), or a
   * fade through black (IX3-D2), placed in the middle of its black frames.
   */
  readonly kind?: 'cut' | 'dissolve' | 'fade';
  /** The transition's grid frames, first and last (the model's transitions, and fades). */
  readonly span?: { readonly from: number; readonly to: number };
}

export interface DetectShotsResult {
  /** Which detector decided: the shot-boundary model (TransNetV2), or scdet (before it, and its fallback). */
  readonly detector: 'model' | 'scdet';
  /** Where the model ran (`coreml`: the mac helper's Core ML; `webgpu`, `cpu`: ONNX Runtime) when it decided. */
  readonly backend?: ComputeBackend;
  readonly frameRate: FrameRate;
  readonly frameCount: number;
  readonly shots: readonly TimeRange[];
  readonly cuts: readonly ShotCut[];
  /** Candidates the second method rejected (flashes, light changes, motion): for tuning. */
  readonly rejected: readonly ShotCut[];
}

export interface ShotsContext {
  readonly signal?: AbortSignal;
  progress?(fraction: number): void;
}

/** Drops the cut that makes a shot shorter than `minFrames`: a short shot joins the previous one (the first, the next). */
export function mergeShortShots<C extends { readonly frame: number }>(
  cuts: readonly C[],
  frameCount: number,
  minFrames: number,
): C[] {
  const kept = [...cuts].sort((a, b) => a.frame - b.frame).filter((c) => c.frame > 0 && c.frame < frameCount);
  for (let changed = true; changed && kept.length > 0;) {
    changed = false;
    const bounds = [0, ...kept.map((c) => c.frame), frameCount];
    for (let i = 0; i + 1 < bounds.length; i++) {
      if ((bounds[i + 1] as number) - (bounds[i] as number) >= minFrames) continue;
      kept.splice(i === 0 ? 0 : i - 1, 1);
      changed = true;
      break;
    }
  }
  return kept;
}

export function shotsFromCuts(cuts: readonly number[], frameCount: number, rate: FrameRate): TimeRange[] {
  const bounds = [0, ...cuts, frameCount];
  const shots: TimeRange[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const start = bounds[i] as number;
    const end = bounds[i + 1] as number;
    if (end > start)
      shots.push({ start: RationalTime.of(start, rate), duration: RationalTime.of(end - start, rate) });
  }
  return shots;
}
