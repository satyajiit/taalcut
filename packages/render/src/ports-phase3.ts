// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the Phase 3 export stages need from other lanes, as small ports the render process's composition root
 * fills (apps/desktop/src/utility/roots/render-phase3.ts). Every one is optional: without it the stage does
 * what the SPEC says for "unavailable" (a centre crop with a warning, no grade, no Style), never a crash.
 */
import type {
  AssetId,
  AsyncResult,
  JobId,
  RenderRecord,
  StyleGrade,
  SubjectTrack,
  TimeRange,
} from '@taalcut/core';

/**
 * The export job that queued work runs for (round P3-3): passed on as `JobRunOptions.parentJobId`, so the jobs
 * queue starts the work at once in the export's own 'gpu' slot instead of behind the export that waits for it.
 */
export interface ExportJobRef {
  readonly parentJobId?: JobId;
}

/** The render record's job (set when the export was queued), as the parent of the work it waits on. */
export const exportJobOf = (record: Pick<RenderRecord, 'jobId'>): ExportJobRef =>
  record.jobId ? { parentJobId: record.jobId } : {};

/** Subject tracks for reframing (P3-V2): the media cache's, and the `render.trackSubjects` job for missing ones. */
export interface SubjectTrackSource {
  /** The stored track covering this range, or null (nothing is started). */
  get(assetId: AssetId, range: TimeRange, signal?: AbortSignal): AsyncResult<SubjectTrack | null>;
  /** Tracks the shot now (through the jobs queue, high priority) and waits; null when tracking is unavailable. */
  track(
    assetId: AssetId,
    range: TimeRange,
    signal?: AbortSignal,
    job?: ExportJobRef,
  ): AsyncResult<SubjectTrack | null>;
}

/** Grade LUTs (P3-V17): vision's `vision.bakeGrade` per clip, cached in the media cache. */
export interface GradeLutSource {
  /** The `.cube` file for this clip and grade (baked through the jobs queue and awaited when missing). */
  lutFor(
    assetId: AssetId,
    range: TimeRange,
    grade: StyleGrade,
    signal?: AbortSignal,
    job?: ExportJobRef,
  ): AsyncResult<string>;
}

/** Where each asset came from (P3-V7's AI inventory): the library's provenance. */
export type { ProvenanceLookup } from './credentials/inventory-of';
