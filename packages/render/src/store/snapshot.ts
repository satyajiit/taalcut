// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stored render as a window or the agent may see it: the snapshot's
 * fields only, never the file path, the request or the full QA report.
 */
import type { JobProgress, RenderRecord, RenderSnapshot, RenderStatus } from '@taalcut/core';

/** A render that has stopped: nothing will change it except delete, restore or an override. */
export const FINAL_RENDER_STATUSES: ReadonlySet<RenderStatus> = new Set([
  'ready',
  'needsAttention',
  'failed',
  'cancelled',
]);

/** Still in the queue or the render process. */
export const RUNNING_RENDER_STATUSES: ReadonlySet<RenderStatus> = new Set([
  'queued',
  'rendering',
  'checking',
  'fixing',
]);

/** `progress` overrides the stored one (the render process keeps live progress in memory). */
export function toRenderSnapshot(record: RenderRecord, progress?: JobProgress | null): RenderSnapshot {
  return {
    id: record.id,
    projectId: record.projectId,
    timelineId: record.timelineId,
    timelineRevision: record.timelineRevision,
    presetId: record.presetId,
    status: record.status,
    jobId: record.jobId,
    progress: progress === undefined ? (record.progress ?? null) : progress,
    name: record.name,
    width: record.width,
    height: record.height,
    rate: record.rate,
    durationFrames: record.durationFrames,
    bytes: record.bytes,
    music: record.music,
    captions: record.captions,
    qa: record.qa,
    supersedes: record.supersedes,
    notify: record.notify,
    error: record.error,
    credentials: record.credentials,
    batchId: record.batchId,
    createdAt: record.createdAt,
    finishedAt: record.finishedAt,
    deletedAt: record.deletedAt,
  };
}
