// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The batch render queue (P3-V16, SPEC P3.6): `render.exportBatch` makes one Render per item, each an
 * ordinary `render.export` job at low priority, so the jobs queue's `gpu` resource runs them one after another,
 * an interactive export overtakes them, a crash resumes the rest, and each render has its own QA and fixes.
 * Unset presets and caption outputs come from each project's export settings. `batchId` is the caller's, so a
 * retry is the same batch (its items dedupe to the renders it already made). Not undoable, like an export;
 * `render.cancelBatch` cancels what is queued or running.
 */
import {
  defineCommand,
  ok,
  RENDER_COMMANDS,
  renderCommandPayloads,
  type AsyncResult,
  type CommandOutcome,
  type ExportRequest,
  type RenderBatchId,
  type RenderId,
} from '@taalcut/core';
import { queueExport } from '../commands/queue-export';
import type { RenderCommandDeps } from '../commands/command-deps';
import { readExportSettings, settingsCodec } from '../settings';
import { FINAL_RENDER_STATUSES } from '../store/snapshot';

export interface BatchReceipt {
  readonly batchId: RenderBatchId;
  readonly renderIds: readonly RenderId[];
}

type BatchPayload = (typeof renderCommandPayloads)[typeof RENDER_COMMANDS.exportBatch]['_output'];
type BatchItem = BatchPayload['items'][number];

/** One item as an export request, unset fields from its project's export settings. */
async function itemRequest(
  deps: RenderCommandDeps,
  payload: BatchPayload,
  item: BatchItem,
): AsyncResult<ExportRequest> {
  const timeline = await deps.timelines.get(item.timelineId);
  const settings = await readExportSettings(
    deps.settings,
    item.projectId,
    timeline.ok ? timeline.value.canvas : undefined,
  );
  if (!settings.ok) return settings;
  return ok({
    projectId: item.projectId,
    timelineId: item.timelineId,
    ...(item.timelineRevision !== undefined ? { timelineRevision: item.timelineRevision } : {}),
    presetId: item.presetId ?? settings.value.presetId,
    // The project's codec goes with the project's preset; an item naming its own preset takes that one's default.
    ...(item.presetId === undefined ? settingsCodec(settings.value) : {}),
    captions: item.captions ?? settings.value.captions,
    // A draft batch is for checking: nothing to announce.
    notify: payload.mode === 'export' && payload.notify,
    contentCredentials: settings.value.contentCredentials,
    includeBumpers: settings.value.includeBumpers,
    batchId: payload.batchId,
  });
}

export function createBatchCommands(deps: RenderCommandDeps) {
  const exportBatch = defineCommand({
    name: RENDER_COMMANDS.exportBatch,
    payload: renderCommandPayloads[RENDER_COMMANDS.exportBatch],
    sideEffect: 'write',
    handle: async (payload): AsyncResult<CommandOutcome<BatchReceipt>> => {
      // Every item checked first, so a bad one refuses the batch before any render is queued.
      const requests: ExportRequest[] = [];
      for (const item of payload.items) {
        const request = await itemRequest(deps, payload, item);
        if (!request.ok) return request;
        const timeline = await deps.timelines.get(item.timelineId);
        if (!timeline.ok) return timeline;
        requests.push(request.value);
      }
      const renderIds: RenderId[] = [];
      for (const request of requests) {
        const queued = await queueExport(deps, request, { priority: 'low' });
        if (!queued.ok) return queued;
        renderIds.push(queued.value.renderId);
      }
      return ok({ result: { batchId: payload.batchId, renderIds } });
    },
  });

  const cancelBatch = defineCommand({
    name: RENDER_COMMANDS.cancelBatch,
    payload: renderCommandPayloads[RENDER_COMMANDS.cancelBatch],
    sideEffect: 'write',
    handle: async ({ batchId }) => {
      const rows = await deps.store.list({ batchId });
      if (!rows.ok) return rows;
      const cancelled: RenderId[] = [];
      for (const record of rows.value) {
        if (FINAL_RENDER_STATUSES.has(record.status)) continue;
        const updated = await deps.store.update(record.id, {
          status: 'cancelled',
          finishedAt: deps.clock.now(),
        });
        if (!updated.ok) return updated;
        cancelled.push(record.id);
        // A queued render never reaches the render process, so nobody else would announce it.
        if (record.status === 'queued')
          deps.events?.emit('render.finished', {
            renderId: record.id,
            projectId: record.projectId,
            status: 'cancelled',
            notify: record.notify,
            name: record.name,
          });
      }
      return ok({ result: { batchId, cancelled } });
    },
  });

  return { exportBatch, cancelBatch, all: [exportBatch, cancelBatch] };
}
