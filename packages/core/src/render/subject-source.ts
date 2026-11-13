// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: the one way timeline and render read where people are in a clip (contract §1). Whatever made the
 * track (the mac helper's Vision or the no-helper ONNX detector), placement, preview, render QA and reframing all
 * read it through this port, so they agree. Render implements it over the subject track store and the
 * `render.trackSubjects` job; the composition roots register it.
 */
import type { AssetId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { RationalTime } from '../time/rational-time';
import type { SubjectDetector, SubjectSample } from './subject-track';

/** A clip's source range: [start, end) of the asset, at the asset's rate. */
export interface SubjectClipRange {
  readonly assetId: AssetId;
  readonly start: RationalTime;
  readonly end: RationalTime;
}

/** Where people are over one clip range. */
export interface SubjectSpan {
  /**
   * The upright frame the samples' boxes are fractions of, in pixels: its aspect is the source's, which placement
   * needs to map the boxes onto a canvas. Null for a track made before FRM1.
   */
  readonly frame: { readonly width: number; readonly height: number } | null;
  readonly detector: SubjectDetector;
  /**
   * The samples inside [start, end), in time order, at the track's rates (detect at `recipe.detectHz`, track
   * samples between). Heads, people and the silhouette are on detect samples only.
   */
  readonly samples: readonly SubjectSample[];
}

export interface SubjectSource {
  /**
   * The samples over [start, end) of a clip, from any track that covers the range; undefined when none is made
   * yet (nothing is started).
   */
  over(clip: SubjectClipRange, signal?: AbortSignal): AsyncResult<SubjectSpan | undefined>;
  /**
   * Makes (or joins) the tracks for these ranges through the jobs queue, and resolves when they exist. An error
   * names why one range has none (the helper is missing, the asset is offline); the others are still made, so a
   * caller may go on and read what `over` has.
   */
  ensure(ranges: readonly SubjectClipRange[], signal?: AbortSignal): AsyncResult<void>;
}
export const SubjectSourceToken = createToken<SubjectSource>('core.subjectSource');
