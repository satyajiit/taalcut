// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The export's subject tracks (P3-V2, SPEC P3.2): the media cache's (the subject store), else the
 * `render.trackSubjects` job through the jobs queue. The job tracks the shot with the mac helper, holding one
 * hardware video session, and keeps the track in the same media cache, where this source reads it back. The export
 * passes its own job as the parent (round P3-3): the export holds the 'gpu' slot the job needs, so the queue starts
 * the job at once. No queue in this process, or an offline asset, means no track: the export centre-crops with a
 * warning.
 */
import {
  ok,
  RationalTime,
  type AssetId,
  type AsyncResult,
  type JobRunner,
  type TimeRange,
} from '@taalcut/core';
import type { ExportJobRef, SubjectTrackSource } from '../ports-phase3';
import type { SubjectTrackStore } from '../reframe/subject-store';
import { trackSubjectsJob } from '../reframe/track-job';

export interface SubjectSourceDeps {
  readonly store: Pick<SubjectTrackStore, 'get'> & Partial<Pick<SubjectTrackStore, 'covering'>>;
  /** The jobs queue (the render process's runner through main); absent, missing shots aren't tracked. */
  readonly runner?: Pick<JobRunner, 'run'>;
  /** The asset's original on disk and its content hash, or null when it is offline (nothing is queued then). */
  asset(assetId: AssetId): AsyncResult<{ readonly path: string; readonly contentHash: string } | null>;
}

const runOptions = (signal: AbortSignal | undefined, job: ExportJobRef | undefined) => ({
  ...(signal ? { signal } : {}),
  ...(job?.parentJobId ? { parentJobId: job.parentJobId } : {}),
});

export function createSubjectTrackSource(deps: SubjectSourceDeps): SubjectTrackSource {
  return {
    async get(assetId, range, signal) {
      const exact = await deps.store.get(assetId, range, signal);
      if (!exact.ok || exact.value || !deps.store.covering) return exact;
      // FRM1: a clip trimmed inside a range assembly tracked reads that track (its samples are by source time).
      return deps.store.covering(assetId, range.start, RationalTime.add(range.start, range.duration));
    },
    async track(assetId: AssetId, range: TimeRange, signal?: AbortSignal, job?: ExportJobRef) {
      if (!deps.runner) return ok(null);
      const asset = await deps.asset(assetId);
      if (!asset.ok || !asset.value) return asset.ok ? ok(null) : asset;
      const tracked = await deps.runner.run(trackSubjectsJob, { assetId, range }, runOptions(signal, job));
      if (!tracked.ok) return tracked;
      // The job kept the track in the media cache this process reads.
      return deps.store.get(assetId, range, signal);
    },
  };
}
