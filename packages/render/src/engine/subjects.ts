// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: core's SubjectSource over the subject track store and the `render.trackSubjects` job (render SPEC
 * "FRM1-SUB"). `over` reads a stored track that holds the clip's range (its own, or a wider one the clip was trimmed
 * inside) and keeps the samples inside the range. `ensure` queues the job for each range with no track, all at once
 * (the jobs queue runs them on its 'gpu' slots, each holding one video session), and waits for them all. Assembly
 * calls it before the first draft, so placement, preview, QA and reframing all read the same tracks.
 */
import {
  err,
  NotFoundError,
  ok,
  RationalTime,
  type AssetId,
  type AsyncResult,
  type JobRunner,
  type SubjectClipRange,
  type SubjectSource,
  type SubjectSpan,
  type Err,
  type SubjectTrack,
  type TaalcutError,
} from '@taalcut/core';
import type { SubjectTrackStore } from '../reframe/subject-store';
import { trackSubjectsJob } from '../reframe/track-job';

export interface SubjectsDeps {
  readonly store: Pick<SubjectTrackStore, 'get' | 'covering'>;
  /** The jobs queue; absent, nothing is tracked and `ensure` says so. */
  readonly runner?: Pick<JobRunner, 'run'>;
  /** The asset's original on disk and its content hash, or null when it is offline. */
  asset(assetId: AssetId): AsyncResult<{ readonly path: string; readonly contentHash: string } | null>;
}

/** The track's range: from the clip's start, its length at the start's rate (the asset's). */
const rangeOf = (clip: SubjectClipRange) => ({
  start: clip.start,
  duration: RationalTime.subtract(RationalTime.rescale(clip.end, clip.start.rate, 'round'), clip.start),
});

const keyOf = (clip: SubjectClipRange) =>
  `${clip.assetId}:${RationalTime.toSeconds(clip.start).toFixed(4)}:${RationalTime.toSeconds(clip.end).toFixed(4)}`;

/** The samples of a track inside [start, end). */
export function spanOf(track: SubjectTrack, start: RationalTime, end: RationalTime): SubjectSpan {
  const from = RationalTime.toSeconds(start) - 1e-6;
  const to = RationalTime.toSeconds(end);
  return {
    frame: track.frame ?? null,
    detector: track.recipe.detector ?? 'vision',
    samples: track.samples.filter((sample) => {
      const t = RationalTime.toSeconds(sample.t);
      return t >= from && t < to;
    }),
  };
}

export function createSubjectSource(deps: SubjectsDeps): SubjectSource {
  const stored = async (clip: SubjectClipRange): AsyncResult<SubjectTrack | null> => {
    const exact = await deps.store.get(clip.assetId, rangeOf(clip));
    if (!exact.ok || exact.value) return exact;
    return deps.store.covering(clip.assetId, clip.start, clip.end);
  };
  const track = async (clip: SubjectClipRange, signal?: AbortSignal): AsyncResult<void> => {
    if (!deps.runner) return err(NotFoundError({ entity: 'subjectTracker' }));
    const asset = await deps.asset(clip.assetId);
    if (!asset.ok) return asset;
    if (!asset.value) return err(NotFoundError({ entity: 'asset', id: clip.assetId }));
    const run = await deps.runner.run(
      trackSubjectsJob,
      { assetId: clip.assetId, range: rangeOf(clip) },
      signal ? { signal } : {},
    );
    return run.ok ? ok(undefined) : run;
  };
  return {
    async over(clip) {
      const found = await stored(clip);
      if (!found.ok) return found;
      return ok(found.value ? spanOf(found.value, clip.start, clip.end) : undefined);
    },
    async ensure(ranges, signal) {
      const unique = new Map(ranges.map((clip) => [keyOf(clip), clip]));
      const missing: SubjectClipRange[] = [];
      for (const clip of unique.values()) {
        const found = await stored(clip);
        if (!found.ok || !found.value) missing.push(clip);
      }
      // Every missing range goes to the queue at once; the first failure is the answer once all have settled.
      const runs = await Promise.all(missing.map((clip) => track(clip, signal)));
      const failed = runs.find((run): run is Err<TaalcutError> => !run.ok);
      return failed ?? ok(undefined);
    },
  };
}
