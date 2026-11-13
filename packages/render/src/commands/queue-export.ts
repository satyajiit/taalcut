// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Queues one export (SPEC section 9): checks the request against the timeline and preset, answers with the
 * live render of the same request (dedupe), keeps the exported revision as a version, creates the Render row
 * and enqueues its `render.export` job. `render.export` queues at normal priority; a batch (P3-V16) queues each
 * item at low priority, so an interactive export overtakes it.
 */
import {
  err,
  NotFoundError,
  ok,
  publicErrorSchema,
  RENDER_JOB_KINDS,
  newId,
  type AsyncResult,
  type ExportRequest,
  type JobPriority,
  type RenderStatus,
} from '@taalcut/core';
import { renderExportJobKey, renderPurgeJobKey } from '../jobs/render-jobs';
import { presetFor } from '../presets/presets.v1';
import type { ExportReceipt, RenderCommandDeps } from './command-deps';
import { exportRequestKey, renderName, resolveExportRequest } from './request';

/** Same request while one of these exists: that render is the answer. */
const DEDUPED: ReadonlySet<RenderStatus> = new Set(['queued', 'rendering', 'checking', 'fixing', 'ready']);

export async function queueExport(
  deps: RenderCommandDeps,
  payload: ExportRequest,
  options: { readonly priority?: JobPriority } = {},
): AsyncResult<ExportReceipt> {
  const now = () => deps.clock.now();
  const timeline = await deps.timelines.get(payload.timelineId);
  if (!timeline.ok) return timeline;
  if (timeline.value.projectId !== payload.projectId)
    return err(NotFoundError({ entity: 'timeline', id: payload.timelineId }));
  const resolved = resolveExportRequest(payload, timeline.value);
  if (!resolved.ok) return resolved;
  const { request, frames } = resolved.value;
  const requestKey = exportRequestKey(request);
  const existing = await deps.store.list({ projectId: request.projectId, requestKey });
  if (!existing.ok) return existing;
  const live = existing.value.find((record) => DEDUPED.has(record.status));
  if (live) {
    if (request.notify && !live.notify) {
      const notified = await deps.store.update(live.id, { notify: true });
      if (!notified.ok) return notified;
    }
    return ok({ renderId: live.id, jobId: live.jobId });
  }

  const preset = presetFor(request.presetId);
  const renderId = deps.newRenderId?.() ?? newId<'Render'>();
  const name = renderName(request, timeline.value.name);
  if (deps.snapshotExport) {
    const kept = await deps.snapshotExport({
      timelineId: request.timelineId,
      revision: request.timelineRevision ?? timeline.value.revision,
      label: name,
    });
    if (!kept.ok) return kept;
  }
  const created = await deps.store.create({
    id: renderId,
    projectId: request.projectId,
    timelineId: request.timelineId,
    timelineRevision: request.timelineRevision ?? timeline.value.revision,
    presetId: request.presetId,
    status: 'queued',
    jobId: null,
    name,
    width: preset.width,
    height: preset.height,
    rate: request.rate ?? timeline.value.canvas.rate,
    durationFrames: frames,
    bytes: null,
    music: timeline.value.music.path,
    captions: request.captions,
    qa: null,
    supersedes: request.supersedes ?? null,
    notify: request.notify,
    error: null,
    credentials: { added: false, state: null },
    batchId: request.batchId ?? null,
    createdAt: now(),
    finishedAt: null,
    deletedAt: null,
    request,
    filePath: null,
    compositionHash: null,
    qaReport: null,
    requestKey,
  });
  if (!created.ok) return created;
  const job = await deps.enqueuer.enqueue({
    kind: RENDER_JOB_KINDS.export,
    input: { renderId, request },
    projectId: request.projectId,
    idempotencyKey: renderExportJobKey(renderId),
    ...(options.priority ? { priority: options.priority } : {}),
  });
  if (!job.ok) {
    const failed = await deps.store.update(renderId, {
      status: 'failed',
      error: publicErrorSchema.parse(job.error),
      finishedAt: now(),
    });
    if (failed.ok)
      deps.events?.emit('render.finished', {
        renderId,
        projectId: failed.value.projectId,
        status: 'failed',
        notify: failed.value.notify,
        name: failed.value.name,
      });
    return job;
  }
  const updated = await deps.store.update(renderId, { jobId: job.value.id });
  if (!updated.ok) return updated;
  // The cache purge rides along once a day: the day's key makes every later enqueue that same job.
  void deps.enqueuer.enqueue({
    kind: RENDER_JOB_KINDS.purge,
    input: {},
    priority: 'low',
    idempotencyKey: renderPurgeJobKey(now()),
  });
  return ok({ renderId, jobId: job.value.id });
}
